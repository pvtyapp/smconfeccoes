import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import { isValidDocument } from "@/lib/portal/document"
import { missingFiscalFields } from "@/lib/portal/fiscalCompleteness"

export async function GET() {
  const session = await getClientSessionFromRequest()
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

  const { rows } = await pool.query(`
    SELECT
      COALESCE(nome_cadastro, name) AS name, phone,
      tipo_pessoa AS "tipoPessoa", cpf_cnpj AS "cpfCnpj", razao_social AS "razaoSocial",
      regime_tributario AS "regimeTributario", inscricao_estadual AS "inscricaoEstadual",
      COALESCE(ie_isento, false) AS "ieIsento",
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
      regimeTributario?: string; inscricaoEstadual?: string; ieIsento?: boolean
      cep?: string; logradouro?: string; numero?: string; complemento?: string
      bairro?: string; cidade?: string; uf?: string; codigoMunicipioIbge?: string
    }

    if (!body.name?.trim()) return NextResponse.json({ error: "Informe seu nome" }, { status: 400 })

    if (body.cpfCnpj?.trim()) {
      const tipo = body.tipoPessoa === "juridica" ? "juridica" : "fisica"
      if (!isValidDocument(body.cpfCnpj, tipo)) {
        return NextResponse.json({ error: tipo === "juridica" ? "CNPJ inválido" : "CPF inválido" }, { status: 400 })
      }
    }

    // Bloqueia salvar incompleto — mostra tudo que falta de uma vez, antes de
    // gravar qualquer coisa (decisão do dono: sempre mostrar antes de salvar).
    const missing = missingFiscalFields({
      tipoPessoa: body.tipoPessoa ?? null,
      cpfCnpj: body.cpfCnpj?.trim() || null,
      razaoSocial: body.razaoSocial?.trim() || null,
      regimeTributario: body.regimeTributario?.trim() || null,
      inscricaoEstadual: body.inscricaoEstadual?.trim() || null,
      ieIsento: body.ieIsento ?? false,
      cep: body.cep?.trim() || null,
      logradouro: body.logradouro?.trim() || null,
      numero: body.numero?.trim() || null,
      bairro: body.bairro?.trim() || null,
      cidade: body.cidade?.trim() || null,
      uf: body.uf?.trim() || null,
      codigoMunicipioIbge: body.codigoMunicipioIbge?.trim() || null,
    })
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Preencha antes de salvar: ${missing.join(", ")}.`, missing },
        { status: 400 }
      )
    }

    await pool.query(`
      UPDATE wa_contacts SET
        nome_cadastro = $1, tipo_pessoa = $2, cpf_cnpj = $3, razao_social = $4,
        regime_tributario = $5, inscricao_estadual = $6, ie_isento = $7,
        cep = $8, logradouro = $9, numero = $10, complemento = $11,
        bairro = $12, cidade = $13, uf = $14, codigo_municipio_ibge = $15, updated_at = NOW()
      WHERE id = $16
    `, [
      body.name.trim(), body.tipoPessoa || null, body.cpfCnpj?.trim() || null, body.razaoSocial?.trim() || null,
      body.regimeTributario?.trim() || null, body.inscricaoEstadual?.trim() || null, body.ieIsento ?? false,
      body.cep?.trim() || null, body.logradouro?.trim() || null,
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
