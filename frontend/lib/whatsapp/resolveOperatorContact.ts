import { pool } from "@/lib/db"

// Garante que existe um wa_contacts pra esse operador (cria na primeira vez,
// reaproveita depois) — linked_user_id é o que marca "isso é operador, não
// cliente de verdade" pro resto do sistema (marketing, tela de Clientes, etc.
// todos precisam filtrar por linked_user_id IS NULL pra não vazar operador
// pra fluxo de cliente).
export async function findOrCreateOperatorContact(
  userId: number, userName: string, phone: string, jid: string
): Promise<number> {
  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS linked_user_id INTEGER REFERENCES users(id)`).catch(() => {})

  const { rows: existing } = await pool.query(
    `SELECT id FROM wa_contacts WHERE linked_user_id = $1 LIMIT 1`,
    [userId]
  )
  if (existing[0]) return existing[0].id

  const phoneJid = `55${phone}@s.whatsapp.net`

  const { rows } = await pool.query(`
    INSERT INTO wa_contacts (name, phone, jid, phone_jid, linked_user_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (jid) DO UPDATE SET linked_user_id = $5, name = $1
    RETURNING id
  `, [userName, phone, jid, phoneJid, userId])

  return rows[0].id
}
