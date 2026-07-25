import { pool } from "@/lib/db"

// Garante que existe um wa_contacts pra esse operador (cria na primeira vez,
// reaproveita depois) — linked_user_id é o que marca "isso é operador, não
// cliente de verdade" pro resto do sistema (marketing, tela de Clientes, etc.
// todos precisam filtrar por linked_user_id IS NULL pra não vazar operador
// pra fluxo de cliente).
//
// O WhatsApp nem sempre manda a mesma identificação (jid) pra quem manda
// mensagem — às vezes vem @lid, às vezes o número resolvido direto — então
// casar só por jid exato pode criar um contato duplicado a cada variação.
// Por isso, antes de criar, também procura por telefone (phone/phone_jid),
// não só pelo vínculo já feito ou pelo jid dessa mensagem específica.
export async function findOrCreateOperatorContact(
  userId: number, userName: string, phone: string, jid: string
): Promise<number> {
  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS linked_user_id INTEGER REFERENCES users(id)`).catch(() => {})

  const { rows: linked } = await pool.query(
    `SELECT id, jid FROM wa_contacts WHERE linked_user_id = $1 LIMIT 1`,
    [userId]
  )
  if (linked[0]) {
    // Mantém o jid sincronizado com a identificação mais recente que o WhatsApp
    // mandou — sem isso, reply() (que casa por jid/phone_jid bruto) pode achar
    // ou criar uma linha diferente da que esse lookup por linked_user_id retorna
    // assim que o número migra de endereçamento (@s.whatsapp.net → @lid), gerando
    // um contato duplicado que separa mensagem recebida de mensagem enviada.
    if (linked[0].jid !== jid) {
      await pool.query(`UPDATE wa_contacts SET jid = $1, updated_at = NOW() WHERE id = $2`, [jid, linked[0].id]).catch(() => {})
    }
    return linked[0].id
  }

  const phoneJid = `55${phone}@s.whatsapp.net`

  const { rows: byPhone } = await pool.query(
    `SELECT id FROM wa_contacts WHERE phone = $1 OR phone_jid = $2 LIMIT 1`,
    [phone, phoneJid]
  )
  if (byPhone[0]) {
    await pool.query(
      `UPDATE wa_contacts SET linked_user_id = $1, name = $2 WHERE id = $3`,
      [userId, userName, byPhone[0].id]
    )
    return byPhone[0].id
  }

  const { rows } = await pool.query(`
    INSERT INTO wa_contacts (name, phone, jid, phone_jid, linked_user_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (jid) DO UPDATE SET linked_user_id = $5, name = $1
    RETURNING id
  `, [userName, phone, jid, phoneJid, userId])

  return rows[0].id
}
