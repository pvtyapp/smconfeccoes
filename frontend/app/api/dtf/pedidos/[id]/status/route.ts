import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"
import { cleanDtfBlobsOnConclude } from "@/lib/blob-cleanup"

const VALID = ["triagem", "em_producao", "pronto", "concluido", "cancelado"]

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()
  try {
    const { id } = await params
    const body = await req.json() as {
      status: string
      metrosFinais?: number
      precoCobrado?: number
      paymentMode?: "avista" | "prazo"
      dueDate?: string
      notifyClient?: boolean
      cancelMessage?: string
      impressoraId?: number
    }
    const { status, metrosFinais, precoCobrado, dueDate, notifyClient, cancelMessage, impressoraId } = body

    if (!VALID.includes(status))
      return NextResponse.json({ error: `Status inválido. Use: ${VALID.join(", ")}` }, { status: 400 })

    await client.query("BEGIN")

    const { rows } = await client.query(`
      SELECT p.id, p.number, p.contact_id, p.created_at AS pedido_created_at,
             p.preco_cobrado AS preco_cobrado_db, p.impressora_id,
             p.film_bobina_id, p.refil_ids, p.metros_bobina_antiga,
             p.metros_finais AS metros_finais_db, p.metros AS metros_db,
             c.name AS "contactName", COALESCE(c.phone_jid, c.jid) AS jid
      FROM dtf_pedidos p
      LEFT JOIN wa_contacts c ON c.id = p.contact_id
      WHERE p.id = $1
    `, [id])

    if (!rows[0]) {
      await client.query("ROLLBACK")
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 })
    }

    const pedido = rows[0]

    if (status === "pronto") {
      // Save metros, preco and due_date; mark lifecycle active
      await client.query(`
        UPDATE dtf_pedidos
        SET status        = 'pronto',
            metros_finais = COALESCE($1::numeric, metros_finais),
            preco_cobrado = COALESCE($2::numeric, preco_cobrado),
            due_date      = $3
        WHERE id = $4
      `, [metrosFinais ?? null, precoCobrado ?? null, dueDate ?? null, id])

      // Pedido reservado numa troca de bobina (esgotou no meio dele) — "Pronto"
      // é o momento em que a metragem final é conhecida de verdade, então é
      // aqui que a reserva provisória vira definitiva. metros_bobina_antiga
      // já está congelado desde a troca (a bobina antiga já fechou, não muda
      // mais) — o que sobra da metragem final é o que realmente veio da
      // bobina nova, ajustando pra mais ou pra menos o que foi reservado.
      const { rows: reservaRows } = await client.query(`
        SELECT id FROM dtf_pedido_bobina_uso WHERE pedido_id = $1 AND status = 'reservado'
      `, [id])
      if (reservaRows[0] && pedido.metros_bobina_antiga != null) {
        const metrosFinalTotal = Number(metrosFinais ?? pedido.metros_finais_db ?? pedido.metros_db ?? 0)
        const metrosNovaFinal = Math.max(0, metrosFinalTotal - Number(pedido.metros_bobina_antiga))
        await client.query(`
          UPDATE dtf_pedido_bobina_uso SET metros = $2, status = 'confirmado' WHERE id = $1
        `, [reservaRows[0].id, metrosNovaFinal])
      }

      if (pedido.contact_id) {
        await client.query(`
          UPDATE wa_contacts
          SET last_order_at = NOW(), lifecycle_state = 'active',
              lifecycle_updated_at = NOW(), ausente_seq = 0
          WHERE id = $1
        `, [pedido.contact_id])
      }

      await client.query("COMMIT")

      // WA: valor/pix já foram avisados em em_producao — aqui só avisa que chegou a vez
      if (pedido.jid) {
        const firstName = pedido.contactName?.trim().split(" ")[0]
        const saudacao   = firstName ? `${firstName}, seu` : "Seu"
        sendAndSave(pedido.contact_id, pedido.jid, `${saudacao} pedido de DTF está pronto para retirada.`).catch(() => {})
      }

    } else if (status === "em_producao") {
      // Vincula o pedido ao ciclo de insumo (bobina de film / refis de tinta e
      // poliamida) que está ATIVO agora, nesse impressora — gravado uma única
      // vez (nunca sobrescrito depois). É esse vínculo, e não mais inferência
      // por timestamp, que os monitores usam pra somar metros por ciclo —
      // fecha o gap de um pedido criado antes de uma troca de bobina mas
      // concluído depois (antes ficava sem contar em nenhum dos dois ciclos).
      const effectiveImpressoraId = impressoraId ?? pedido.impressora_id ?? null
      let filmBobinaId: number | null = pedido.film_bobina_id ?? null
      let refilIds: number[] | null = pedido.refil_ids ?? null

      if (effectiveImpressoraId != null && filmBobinaId == null) {
        const { rows: fb } = await client.query(
          `SELECT id FROM dtf_film_bobinas WHERE impressora_id = $1 AND fechada_em IS NULL LIMIT 1`,
          [effectiveImpressoraId]
        )
        filmBobinaId = fb[0]?.id ?? null
      }
      if (effectiveImpressoraId != null && refilIds == null) {
        const { rows: rf } = await client.query(
          `SELECT array_agg(id) AS ids FROM dtf_printer_refis WHERE impressora_id = $1 AND fechada_em IS NULL`,
          [effectiveImpressoraId]
        )
        refilIds = rf[0]?.ids ?? null
      }

      await client.query(`
        UPDATE dtf_pedidos
        SET status         = 'em_producao',
            metros_finais  = COALESCE($1::numeric, metros_finais),
            preco_cobrado  = COALESCE($2::numeric, preco_cobrado),
            impressora_id  = COALESCE($4::int, impressora_id),
            film_bobina_id = COALESCE(film_bobina_id, $5::int),
            refil_ids      = COALESCE(refil_ids, $6::int[])
        WHERE id = $3
      `, [metrosFinais ?? null, precoCobrado ?? null, id, impressoraId ?? null, filmBobinaId, refilIds])

      await client.query("COMMIT")

      if (pedido.jid) {
        const { rows: s } = await pool.query(
          `SELECT key, value FROM app_settings WHERE key = 'pix_key_dtf'`
        )
        const pixKey = s[0]?.value

        let msg = `Ficando pronto te aviso pra retirar, seu pedido está em produção.`
        if (metrosFinais) msg += `\n📐 Metragem: *${Number(metrosFinais).toFixed(2)} m*`
        if (precoCobrado) msg += `\n💰 Valor: *R$ ${Number(precoCobrado).toFixed(2).replace(".", ",")}*`
        if (pixKey) msg += `\n💳 Pix: \`${pixKey}\``
        sendAndSave(pedido.contact_id, pedido.jid, msg).catch(() => {})
      }

    } else {
      await client.query(`
        UPDATE dtf_pedidos
        SET status       = $1,
            concluded_at = CASE WHEN $1 = 'concluido' THEN NOW() ELSE concluded_at END
        WHERE id = $2
      `, [status, id])

      // Cancelou antes de chegar em "Pronto" — libera a reserva provisória
      // de volta pro saldo disponível da bobina nova.
      if (status === "cancelado") {
        await client.query(`
          DELETE FROM dtf_pedido_bobina_uso WHERE pedido_id = $1 AND status = 'reservado'
        `, [id])
      }

      await client.query("COMMIT")

      // cancelado WA
      if (status === "cancelado" && pedido.jid && notifyClient !== false) {
        const msg = cancelMessage?.trim()
          || `❌ Seu pedido DTF *${pedido.number}* foi cancelado. Qualquer dúvida, entre em contato.`
        sendAndSave(pedido.contact_id, pedido.jid, msg).catch(() => {})
      }
    }

    // Free DTF blobs when order is done (fire-and-forget)
    if ((status === "concluido" || status === "cancelado") && pedido.contact_id) {
      cleanDtfBlobsOnConclude(pedido.contact_id, new Date(pedido.pedido_created_at)).catch(() => {})
    }

    return NextResponse.json({ ok: true, status })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
