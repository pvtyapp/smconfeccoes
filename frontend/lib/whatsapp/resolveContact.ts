import type { Pool, PoolClient } from "pg"

type Queryable = Pool | PoolClient

export function normalizePhone(raw: string): { phone: string; jid: string } {
  const digits = raw.replace(/\D/g, "")
  // Already has country code (55 + 12 or 13 digits total)
  const withCC = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`
  return { phone: withCC, jid: `${withCC}@s.whatsapp.net` }
}

// Cria ou reaproveita um contato a partir de nome+telefone digitado manualmente
// (PDV, Cadastro de Clientes, Novo Pedido). Sempre gera jid válido — nunca deixa
// contato órfão sem jid — e antes de inserir verifica se já existe alguém com esse
// telefone sob outro jid (ex: @lid ainda não resolvido), pra não duplicar cliente.
export async function findOrCreateManualContact(
  db: Queryable,
  name: string | null,
  rawPhone: string
): Promise<number> {
  const { phone, jid } = normalizePhone(rawPhone)
  const trimmedName = name?.trim() || null

  const { rows: existing } = await db.query(
    `SELECT id FROM wa_contacts
     WHERE phone = $1 OR phone_jid = $2
     ORDER BY CASE WHEN jid LIKE '%@lid' THEN 0 ELSE 1 END
     LIMIT 1`,
    [phone, jid]
  )
  if (existing[0]) {
    const id = existing[0].id as number
    if (trimmedName) {
      await db.query(
        `UPDATE wa_contacts SET name = COALESCE(name, $1), updated_at = NOW() WHERE id = $2`,
        [trimmedName, id]
      )
    }
    return id
  }

  const { rows } = await db.query(
    `INSERT INTO wa_contacts (name, phone, jid)
     VALUES ($1, $2, $3)
     ON CONFLICT (jid) DO UPDATE SET
       name = CASE WHEN $1 IS NOT NULL AND $1 != '' THEN $1 ELSE wa_contacts.name END,
       updated_at = NOW()
     RETURNING id`,
    [trimmedName, phone, jid]
  )
  return rows[0].id as number
}
