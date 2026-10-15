import { pool } from "@/lib/db"
import { variantesDo9 } from "@/lib/whatsapp/resolveContact"

// Normaliza qualquer formato digitado (com máscara, com ou sem DDI) pro padrão
// usado em todo o sistema: 55DDNNNNNNNNN (13 dígitos, celular BR com o 9º dígito).
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "")
  if (digits.length === 11) digits = `55${digits}` // DD + 9 dígitos, sem DDI
  // celular digitado sem o 9º dígito (DD + 8, ou 55 + DD + 8): completa com o 9
  if (digits.length === 10 && /^\d{2}[6-9]/.test(digits)) digits = `55${digits.slice(0, 2)}9${digits.slice(2)}`
  if (digits.length === 12 && /^55\d{2}[6-9]/.test(digits)) digits = `${digits.slice(0, 4)}9${digits.slice(4)}`
  if (digits.length !== 13 || !digits.startsWith("55")) return null
  return digits
}

export type MatchedContact = {
  id: number
  name: string | null
  jid: string
  phone_jid: string | null
}

// Casa contra a base existente — INCLUI linha de operador (linked_user_id):
// um admin (Pedro, Mario, Mari, Samuel) que também compra como cliente no
// próprio WhatsApp precisa logar/cadastrar no portal reconhecendo o histórico
// de pedidos dele normalmente, sem ser tratado como cliente novo. A exclusão
// de operador que existe em marketing/lifecycle/contatos (pra não confundir
// staff com lead) é um filtro à parte, feito na própria query de cada um
// desses lugares — não tem relação com login/cadastro do portal. Decidido
// com o PIV em 2026-09-22, achado durante auditoria do bot administrativo.
// Ver seção "Base existente" do plano: 677/707 contatos casam direto por aqui.
// name já vem como COALESCE(nome_cadastro, name) — mesmo padrão usado no resto
// do sistema (ex: emissão de nota fiscal), a correção manual do operador nunca
// perde pro nome cru importado do WhatsApp.
//
// Também casa o mesmo celular SEM o 9º dígito (PIV 15/10): tem número antigo que o
// WhatsApp registra sem o 9 (JID 55DDNNNNNNNN), e a mensagem recebida regrava o phone
// assim. Sem isso o portal não achava o cliente e criava um 2º cadastro (Luiz Henrique,
// duplicado 2x: 11/09 e 22/09). O número exato digitado tem preferência.
export async function findContactByPhone(phone: string): Promise<MatchedContact | null> {
  const sem9 = variantesDo9(phone)[1] ?? phone
  const { rows } = await pool.query(
    `SELECT id, COALESCE(nome_cadastro, name) AS name, jid, phone_jid FROM wa_contacts
     WHERE phone IN ($1, $2) OR phone_jid LIKE $1 || '@%' OR phone_jid LIKE $2 || '@%'
     ORDER BY (phone = $1 OR phone_jid LIKE $1 || '@%') DESC, id
     LIMIT 1`,
    [phone, sem9]
  )
  return rows[0] ?? null
}
