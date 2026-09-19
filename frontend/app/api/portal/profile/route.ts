import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import { isValidDocument } from "@/lib/portal/document"

export async function GET() {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  const { rows } = await pool.query(`
    SELECT
      COALESCE(nome_cadastro, name) AS name, phone,
      tipo_pessoa AS "tipoPessoa", cpf_cnpj AS "cpfCnpj", razao_social AS "razaoSocial",
      inscricao_estadual AS "inscricaoEstadual",
      cep, logradouro, numero, complemento, bairro, cidade, uf,
      codigo_municipio_ibge AS "codigoMunicipioIbge"
    FROM wa_contacts WHERE id = $1
  `, [session.contactId])
  const row = rows[0]
  if (!row) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 })
  return NextResponse.json(row)
}

export async function PATCH(req: Request) {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  try {
    const body = await req.json() as {
      name?: string; tipoPessoa?: "fisica" | "juridica"; cpfCnpj?: string; razaoSocial?: string
      inscricaoEstadual?: string; cep?: string; logradouro?: string; numero?: string; complemento?: string
      bairro?: string; cidade?: string; uf?: string; codigoMunicipioIbge?: string
    }

    if (!body.name?.trim()) return NextResponse.json({ error: "Informe seu nome" }, { status: 400 })

    if (body.cpfCnpj?.trim()) {
      const tipo = body.tipoPessoa === "juridica" ? "juridica" : "fisica"
      if (!isValidDocument(body.cpfCnpj, tipo)) {
        return NextResponse.json({ error: tipo === "juridica" ? "CNPJ inválido" : "CPF inválido" }, { status: 400 })
      }
    }
    if (body.tipoPessoa === "juridica" && body.cpfCnpj?.trim() && !body.razaoSocial?.trim()) {
      return NextResponse.json({ error: "Informe a razão social" }, { status: 400 })
    }

    await pool.query(`
      UPDATE wa_contacts SET
        nome_cadastro = $1, tipo_pessoa = $2, cpf_cnpj = $3, razao_social = $4,
        inscricao_estadual = $5, cep = $6, logradouro = $7, numero = $8, complemento = $9,
        bairro = $10, cidade = $11, uf = $12, codigo_municipio_ibge = $13, updated_at = NOW()
      WHERE id = $14
    `, [
      body.name.trim(), body.tipoPessoa || null, body.cpfCnpj?.trim() || null, body.razaoSocial?.trim() || null,
      body.inscricaoEstadual?.trim() || null, body.cep?.trim() || null, body.logradouro?.trim() || null,
      body.numero?.trim() || null, body.complemento?.trim() || null, body.bairro?.trim() || null,
      body.cidade?.trim() || null, body.uf?.trim() || null, body.codigoMunicipioIbge?.trim() || null,
      session.contactId,
    ])

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
