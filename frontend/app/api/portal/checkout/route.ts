import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"
import { isOutsideBusinessHours } from "@/lib/portal/businessHours"

function fmtR(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export async function POST(req: Request) {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Faça login pra finalizar o pedido" }, { status: 401 })

  const client = await pool.connect()
  try {
    const { items, paymentMethod } = await req.json() as {
      items: { variantId: string; qty: number }[]
      paymentMethod: "pix" | "prazo"
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Carrinho vazio" }, { status: 400 })
    }
    if (paymentMethod !== "pix" && paymentMethod !== "prazo") {
      return NextResponse.json({ error: "Forma de pagamento inválida" }, { status: 400 })
    }

    // Soma qty por variantId antes de qualquer validação — um payload malicioso
    // (fora da UI normal, que já manda mesclado) poderia fatiar a mesma variante
    // em várias linhas pra passar pela checagem "qty <= disponível" item a item
    // e ainda assim pedir mais do que existe no total.
    const mergedQty = new Map<string, number>()
    for (const i of items as { variantId: string; qty: number }[]) {
      mergedQty.set(i.variantId, (mergedQty.get(i.variantId) ?? 0) + (Number(i.qty) || 0))
    }
    const dedupedItems = [...mergedQty.entries()].map(([variantId, qty]) => ({ variantId, qty }))

    const { rows: contactRows } = await pool.query(
      `SELECT id, COALESCE(nome_cadastro, name) AS name, jid, phone_jid, payment_term_enabled
       FROM wa_contacts WHERE id = $1`,
      [session.contactId]
    )
    const contact = contactRows[0]
    if (!contact) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })
    if (paymentMethod === "prazo" && !contact.payment_term_enabled) {
      return NextResponse.json({ error: "Sua conta não tem prazo habilitado" }, { status: 400 })
    }

    await client.query("BEGIN")
    // Mesmo padrão do webhook — evita duplo pedido em duplo clique/duas abas.
    await client.query("SELECT pg_advisory_xact_lock($1)", [contact.id])

    // Trava e revalida contra dado real do servidor — nunca confia em preço/nome
    // mandado pelo cliente (só variantId + qty).
    const variantIds = dedupedItems.map((i) => i.variantId)
    await client.query(`SELECT id FROM product_variants WHERE id = ANY($1) FOR UPDATE`, [variantIds])

    const { rows: variantRows } = await client.query(`
      SELECT
        pv.id AS "variantId", pv.color, pv.size, pv.product_id AS "productId", p.name AS "productName",
        COALESCE(pv.sale_price, p.sale_price, 0) AS "salePrice",
        GREATEST(0, COALESCE(bal.qty, 0) - COALESCE(locked.locked_qty, 0))::int AS available
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN (
        SELECT variant_id, SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END) AS qty
        FROM stock_movements GROUP BY variant_id
      ) bal ON bal.variant_id = pv.id
      LEFT JOIN (
        SELECT oi.variant_id, SUM(oi.qty) AS locked_qty
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status IN ('triagem', 'em_separacao', 'pronto') AND oi.variant_id IS NOT NULL
        GROUP BY oi.variant_id
      ) locked ON locked.variant_id = pv.id
      WHERE pv.id = ANY($1) AND pv.status = 'active'
    `, [variantIds])

    const byId = new Map(variantRows.map((r) => [r.variantId, r]))
    const insufficient: string[] = []
    for (const item of dedupedItems) {
      const v = byId.get(item.variantId)
      if (!v) { insufficient.push("item não encontrado"); continue }
      if (!Number.isInteger(item.qty) || item.qty < 1) { insufficient.push(`${v.productName}: quantidade inválida`); continue }
      if (item.qty > v.available) {
        insufficient.push(`${[v.productName, v.color, v.size].filter(Boolean).join(" ")}: indisponível`)
      }
    }
    if (insufficient.length > 0) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: `Estoque mudou — ${insufficient.join("; ")}` }, { status: 409 })
    }

    const total = dedupedItems.reduce((s, i) => s + Number(byId.get(i.variantId)!.salePrice) * i.qty, 0)

    const numRes = await client.query("SELECT nextval('order_number_seq') AS n")
    const number = `PED-${String(numRes.rows[0].n).padStart(4, "0")}`

    // Nasce direto em em_separacao, não triagem — triagem existe pra pedido
    // sem estrutura (WhatsApp), aqui o item já é real e o estoque já foi
    // travado (FOR UPDATE acima). Só falta separar fisicamente.
    const { rows: orderRows } = await client.query(`
      INSERT INTO orders (number, contact_id, status, source, total_value, payment_method)
      VALUES ($1, $2, 'em_separacao', 'site', $3, $4)
      RETURNING id
    `, [number, contact.id, total, paymentMethod])
    const orderId = orderRows[0].id

    for (const item of dedupedItems) {
      const v = byId.get(item.variantId)!
      await client.query(`
        INSERT INTO order_items (order_id, product_id, product_name, color, size, qty, unit_price, is_service, variant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
      `, [orderId, v.productId, v.productName, v.color, v.size, item.qty, v.salePrice, v.variantId])
    }

    await client.query(`
      INSERT INTO order_events (order_id, status, actor, note)
      VALUES ($1, 'em_separacao', 'site', 'Pedido criado pelo cliente no site — estoque já travado, direto pra separação')
    `, [orderId])

    await client.query(`
      UPDATE wa_contacts SET lifecycle_state = 'active', lifecycle_updated_at = NOW(),
        last_order_at = NOW(), ausente_seq = 0, updated_at = NOW()
      WHERE id = $1
    `, [contact.id])

    await client.query("COMMIT")

    const outsideHours = await isOutsideBusinessHours().catch(() => false)

    // Pedido já está gravado e commitado — daqui pra baixo é só aviso. Qualquer
    // falha aqui (WhatsApp fora do ar, settings sumindo) nunca pode virar erro
    // pro cliente, senão ele acha que o pedido não foi feito e tenta de novo.
    try {
      if (contact.jid) {
        const sendJid = contact.phone_jid || contact.jid
        const lines = dedupedItems.map((i) => {
          const v = byId.get(i.variantId)!
          return `${i.qty}x ${v.productName}${[v.color, v.size].filter(Boolean).length ? ` (${[v.color, v.size].filter(Boolean).join(", ")})` : ""} — ${fmtR(Number(v.salePrice) * i.qty)}`
        })
        const pagamento = paymentMethod === "prazo"
          ? "Pagamento: prazo combinado com a loja."
          : "Pagamento: PIX — a chave chega na próxima mensagem."
        const horarioNota = outsideHours
          ? "\n\nEstamos fora do horário de atendimento — a separação começa no próximo horário comercial."
          : ""
        const resumo = `✅ Pedido *${number}* recebido!\n\n${lines.join("\n")}\n\n💰 Total: *${fmtR(total)}*\n\n${pagamento}${horarioNota}`
        await sendAndSave(contact.id, sendJid, resumo).catch(() => {})

        if (paymentMethod === "pix") {
          const { rows: s } = await pool.query(`SELECT value FROM app_settings WHERE key = 'pix_key_pedidos'`).catch(() => ({ rows: [] as { value: string }[] }))
          const pixKey = s[0]?.value
          if (pixKey) {
            await sendAndSave(contact.id, sendJid, pixKey).catch(() => {})
            await sendAndSave(contact.id, sendJid, "Pode nos mandar o comprovante aqui mesmo, assim que fizer o pagamento 🙏").catch(() => {})
          }
        }
      }
    } catch (notifyErr) {
      console.error("[checkout] pedido criado, mas aviso pelo WhatsApp falhou:", notifyErr)
    }

    return NextResponse.json({ ok: true, number, outsideBusinessHours: outsideHours })
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    client.release()
  }
}
