import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { findOrCreateManualContact } from "@/lib/whatsapp/resolveContact"

export async function POST(req: Request) {
  try {
    const { name, phone } = await req.json()
    if (!phone?.trim()) return NextResponse.json({ error: "Telefone é obrigatório" }, { status: 400 })

    const id = await findOrCreateManualContact(pool, name, phone)
    const { rows } = await pool.query(
      `SELECT id, name, phone, jid FROM wa_contacts WHERE id = $1`,
      [id]
    )

    return NextResponse.json(rows[0], { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  try {
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS linked_user_id INTEGER REFERENCES users(id)`).catch(() => {})
    const { rows } = await pool.query(`
      SELECT
        c.id,
        COALESCE(c.nome_cadastro, c.name) AS name,
        c.name                    AS "nomeWhatsapp",
        c.nome_cadastro           AS "nomeCadastro",
        c.phone,
        c.phone_jid  AS "phoneJid",
        c.jid,
        c.lifecycle_state        AS "lifecycleState",
        c.last_order_at          AS "lastOrderAt",
        c.payment_term_enabled   AS "paymentTermEnabled",
        c.payment_term_type      AS "paymentTermType",
        c.payment_term_days      AS "paymentTermDays",
        c.preco_exclusivo                        AS "precoExclusivo",
        c.chatbot_obs                            AS "chatbotObs",
        COALESCE(c.chatbot_produto_enabled, true)  AS "chatbotProdutoEnabled",
        COALESCE(c.chatbot_dtf_enabled, false)     AS "chatbotDtfEnabled",
        c.state                                  AS "chatbotState",
        c.cpf_cnpj                               AS "cpfCnpj",
        c.tipo_pessoa                             AS "tipoPessoa",
        c.inscricao_estadual                      AS "inscricaoEstadual",
        c.cep, c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf,
        c.codigo_municipio_ibge                   AS "codigoMunicipioIbge",
        c.created_at                             AS "createdAt",
        COUNT(o.id)
          FILTER (WHERE o.status = 'concluido')             AS "orderCount",
        COALESCE(
          SUM(o.total_value)
          FILTER (WHERE o.status = 'concluido'), 0
        ) + COALESCE(
          SUM(dp.preco_cobrado)
          FILTER (WHERE dp.status = 'concluido'), 0
        )                                                  AS "totalSpent"
      FROM wa_contacts c
      LEFT JOIN orders o ON o.contact_id = c.id
      LEFT JOIN dtf_pedidos dp ON dp.contact_id = c.id
      WHERE c.linked_user_id IS NULL
      GROUP BY c.id
      ORDER BY COALESCE(c.last_order_at, c.created_at) DESC
    `)
    return NextResponse.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
