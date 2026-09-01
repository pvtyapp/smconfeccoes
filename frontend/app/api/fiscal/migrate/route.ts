import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Schema da emissão de NFe (Focus NFe). Dados fiscais do cliente/produto ficam
// opcionais até a hora de emitir — a validação de obrigatoriedade acontece no
// motor de emissão (app/api/fiscal/emitir), não aqui.
export async function POST() {
  try {
    // Correção de nome (WhatsApp importa "Fé em Deus", operador corrige pra
    // "João Silva") — nunca sobrescreve wa_contacts.name, que o sync do chat
    // continua re-escrevendo a partir do pushName do WhatsApp.
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS nome_cadastro TEXT`)

    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS tipo_pessoa TEXT CHECK (tipo_pessoa IN ('fisica', 'juridica'))`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS inscricao_estadual TEXT`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS cep TEXT`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS logradouro TEXT`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS numero TEXT`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS complemento TEXT`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS bairro TEXT`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS cidade TEXT`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS uf TEXT`)
    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS codigo_municipio_ibge TEXT`)

    // Dados fiscais do produto — CFOP não é calculado, são 2 valores fixos
    // cadastrados (dentro/fora do estado) escolhidos pelo UF do cliente na hora
    // de emitir.
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ncm TEXT`)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cest TEXT`)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS origem TEXT`)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS csosn TEXT`)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS unidade_tributavel TEXT NOT NULL DEFAULT 'UN'`)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cfop_dentro_estado TEXT NOT NULL DEFAULT '5101'`)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cfop_fora_estado TEXT NOT NULL DEFAULT '6101'`)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fiscal_notes (
        id                   SERIAL PRIMARY KEY,
        order_id             INTEGER NOT NULL REFERENCES orders(id),
        status               TEXT NOT NULL DEFAULT 'pendente'
                               CHECK (status IN ('pendente', 'processando', 'autorizada', 'rejeitada')),
        ambiente             TEXT NOT NULL DEFAULT 'homologacao',
        ref                  TEXT NOT NULL UNIQUE,
        chave_acesso         TEXT,
        numero               TEXT,
        serie                TEXT,
        protocolo            TEXT,
        motivo_rejeicao      TEXT,
        xml                  TEXT,
        pdf                  TEXT,
        valor_total          NUMERIC(10,2),
        criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        autorizado_em        TIMESTAMPTZ,
        enviado_email_em     TIMESTAMPTZ,
        enviado_whatsapp_em  TIMESTAMPTZ
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fiscal_notes_order ON fiscal_notes(order_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fiscal_notes_status ON fiscal_notes(status)`)

    // Config fiscal (token, CNPJ emitente, ambiente, série) reaproveita a
    // tabela genérica app_settings já usada pelo resto do sistema — ver
    // ALLOWED_KEYS em app/api/settings/route.ts — em vez de uma tabela própria.

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
