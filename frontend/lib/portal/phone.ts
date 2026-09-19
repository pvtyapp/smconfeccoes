import { pool } from "@/lib/db"

// Normaliza qualquer formato digitado (com máscara, com ou sem DDI) pro padrão
// usado em todo o sistema: 55DDNNNNNNNNN (13 dígitos, celular BR com o 9º dígito).
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "")
  if (digits.length === 11) digits = `55${digits}` // DD + 9 dígitos, sem DDI
  if (digits.length !== 13 || !digits.startsWith("55")) return null
  return digits
}

export type MatchedContact = {
  id: number
  name: string | null
  jid: string
  phone_jid: string | null
}

// Casa contra a base existente — nunca contra linha de operador (linked_user_id).
// Ver seção "Base existente" do plano: 677/707 contatos casam direto por aqui.
// name já vem como COALESCE(nome_cadastro, name) — mesmo padrão usado no resto
// do sistema (ex: emissão de nota fiscal), a correção manual do operador nunca
// perde pro nome cru importado do WhatsApp.
export async function findContactByPhone(phone: string): Promise<MatchedContact | null> {
  const { rows } = await pool.query(
    `SELECT id, COALESCE(nome_cadastro, name) AS name, jid, phone_jid FROM wa_contacts
     WHERE linked_user_id IS NULL AND (phone = $1 OR phone_jid LIKE $1 || '@%')
     LIMIT 1`,
    [phone]
  )
  return rows[0] ?? null
}
