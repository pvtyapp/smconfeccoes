import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const daysRaw = parseInt(searchParams.get("days") ?? "0")
    const days = Number.isFinite(daysRaw) && daysRaw >= 0 ? daysRaw : 0

    const contactRes = await pool.query(`
      SELECT
        id,
        COALESCE(nome_cadastro, name) AS name,
        name                        AS "nomeWhatsapp",
        nome_cadastro               AS "nomeCadastro",
        phone, jid,
        lifecycle_state            AS "lifecycleState",
        state                      AS "chatbotState",
        last_order_at              AS "lastOrderAt",
        payment_term_enabled       AS "paymentTermEnabled",
        payment_term_type          AS "paymentTermType",
        payment_term_days          AS "paymentTermDays",
        preco_exclusivo            AS "precoExclusivo",
        chatbot_obs                AS "chatbotObs",
        COALESCE(chatbot_produto_enabled, true)  AS "chatbotProdutoEnabled",
        COALESCE(chatbot_dtf_enabled, false)     AS "chatbotDtfEnabled",
        cpf_cnpj                   AS "cpfCnpj",
        tipo_pessoa                AS "tipoPessoa",
        inscricao_estadual         AS "inscricaoEstadual",
        cep, logradouro, numero, complemento, bairro, cidade, uf,
        codigo_municipio_ibge      AS "codigoMunicipioIbge",
        created_at                 AS "createdAt"
      FROM wa_contacts
      WHERE id = $1
    `, [id])

    if (!contactRes.rows[0])
      return NextResponse.json({ error: "Contato não encontrado" }, { status: 404 })

    const periodFilter = days > 0 ? `AND o.created_at >= NOW() - INTERVAL '${days} days'` : ""

    // Product orders
    const ordersRes = await pool.query(`
      SELECT
        o.id, o.number, o.status, o.total_value AS "totalValue",
        o.due_date AS "dueDate", o.paid_at AS "paidAt",
        o.created_at AS "createdAt",
        'produto' AS tipo,
        json_agg(
          json_build_object(
            'id', oi.id, 'productName', oi.product_name,
            'color', oi.color, 'size', oi.size,
            'qty', oi.qty, 'unitPrice', oi.unit_price
          ) ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.contact_id = $1 AND o.status != 'cancelado'
        ${periodFilter}
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `, [id])

    // DTF orders
    const periodFilterDtf = days > 0 ? `AND p.created_at >= NOW() - INTERVAL '${days} days'` : ""
    const dtfRes = await pool.query(`
      SELECT
        p.id, p.number, p.status, p.preco_cobrado AS "totalValue",
        p.due_date AS "dueDate", NULL AS "paidAt",
        p.created_at AS "createdAt",
        'dtf' AS tipo,
        p.metros, p.metros_finais AS "metrosFinais", p.largura_cm AS "larguraCm",
        p.observacao,
        COALESCE(
          json_agg(
            json_build_object('id', a.id, 'filename', a.filename)
            ORDER BY a.id
          ) FILTER (WHERE a.id IS NOT NULL), '[]'
        ) AS attachments
      FROM dtf_pedidos p
      LEFT JOIN dtf_order_attachments a ON a.pedido_id = p.id
      WHERE p.contact_id = $1 AND p.status != 'cancelado'
        ${periodFilterDtf}
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [id])

    return NextResponse.json({
      contact: contactRes.rows[0],
      orders:  ordersRes.rows,
      dtf:     dtfRes.rows,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Cascade delete in dependency order
    await pool.query(`DELETE FROM wa_messages WHERE contact_id = $1`, [id])
    await pool.query(`DELETE FROM wa_contact_tags WHERE contact_id = $1`, [id]).catch(() => {})
    await pool.query(`DELETE FROM wa_contact_offers WHERE contact_id = $1`, [id]).catch(() => {})
    await pool.query(`DELETE FROM product_reservations WHERE contact_id = $1`, [id]).catch(() => {})
    await pool.query(`
      DELETE FROM order_items WHERE order_id IN (
        SELECT id FROM orders WHERE contact_id = $1
      )`, [id])
    await pool.query(`DELETE FROM orders WHERE contact_id = $1`, [id])
    await pool.query(`
      DELETE FROM dtf_order_attachments WHERE pedido_id IN (
        SELECT id FROM dtf_pedidos WHERE contact_id = $1
      )`, [id]).catch(() => {})
    await pool.query(`DELETE FROM dtf_pedidos WHERE contact_id = $1`, [id])
    await pool.query(`DELETE FROM wa_contacts WHERE id = $1`, [id])

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const {
      name, enabled, type, days, precoExclusivo, chatbotObs, chatbotProdutoEnabled, chatbotDtfEnabled,
      cpfCnpj, tipoPessoa, inscricaoEstadual,
      cep, logradouro, numero, complemento, bairro, cidade, uf, codigoMunicipioIbge,
    } = await req.json()

    // "name" aqui é a correção manual do operador — nunca escreve na coluna
    // `name` (essa é só o import do perfil do WhatsApp, re-sincronizado todo dia
    // pelo cron do chat; escrever nela aqui seria apagado na próxima sync).
    await pool.query(`
      UPDATE wa_contacts
      SET nome_cadastro             = COALESCE(NULLIF($1, ''), nome_cadastro),
          payment_term_enabled      = $2,
          payment_term_type         = $3,
          payment_term_days         = $4,
          preco_exclusivo           = $5,
          chatbot_obs               = $6,
          chatbot_produto_enabled   = COALESCE($7, chatbot_produto_enabled),
          chatbot_dtf_enabled       = COALESCE($8, chatbot_dtf_enabled),
          cpf_cnpj                  = COALESCE(NULLIF($9, ''), cpf_cnpj),
          tipo_pessoa               = COALESCE(NULLIF($10, ''), tipo_pessoa),
          inscricao_estadual        = COALESCE(NULLIF($11, ''), inscricao_estadual),
          cep                       = COALESCE(NULLIF($12, ''), cep),
          logradouro                = COALESCE(NULLIF($13, ''), logradouro),
          numero                    = COALESCE(NULLIF($14, ''), numero),
          complemento               = COALESCE(NULLIF($15, ''), complemento),
          bairro                    = COALESCE(NULLIF($16, ''), bairro),
          cidade                    = COALESCE(NULLIF($17, ''), cidade),
          uf                        = COALESCE(NULLIF($18, ''), uf),
          codigo_municipio_ibge     = COALESCE(NULLIF($19, ''), codigo_municipio_ibge)
      WHERE id = $20
    `, [
      name?.trim() ?? null,
      Boolean(enabled),
      enabled ? (type ?? null) : null,
      enabled && type === "days" ? (days ?? null) : null,
      precoExclusivo !== undefined ? Boolean(precoExclusivo) : false,
      chatbotObs ?? null,
      chatbotProdutoEnabled !== undefined ? Boolean(chatbotProdutoEnabled) : null,
      chatbotDtfEnabled !== undefined ? Boolean(chatbotDtfEnabled) : null,
      cpfCnpj?.trim() ?? null,
      tipoPessoa ?? null,
      inscricaoEstadual?.trim() ?? null,
      cep?.trim() ?? null,
      logradouro?.trim() ?? null,
      numero?.trim() ?? null,
      complemento?.trim() ?? null,
      bairro?.trim() ?? null,
      cidade?.trim() ?? null,
      uf?.trim() ?? null,
      codigoMunicipioIbge?.trim() ?? null,
      id,
    ])

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
