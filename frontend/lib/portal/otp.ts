import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { findContactByPhone } from "@/lib/portal/phone"

const CODE_TTL_MINUTES = 10
const RESEND_COOLDOWN_SECONDS = 60
const MAX_ATTEMPTS = 5

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export type OtpPurpose = "signup" | "reset_password"

export async function sendOtpCode(
  phone: string,
  purpose: OtpPurpose
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { rows: recent } = await pool.query(
    `SELECT 1 FROM whatsapp_otp_codes
     WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
       AND created_at > NOW() - ($3 || ' seconds')::interval
     LIMIT 1`,
    [phone, purpose, RESEND_COOLDOWN_SECONDS]
  )
  if (recent.length) {
    return { ok: false, error: "Aguarde um instante antes de pedir outro código." }
  }

  const code = generateCode()
  await pool.query(
    `INSERT INTO whatsapp_otp_codes (phone, code, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)`,
    [phone, code, purpose, CODE_TTL_MINUTES]
  )

  // Contato já conhecido → usa o jid real (cobre @lid). Número inédito → jid
  // construído direto, igual o resto do sistema já faz pra número novo.
  const contact = await findContactByPhone(phone)
  const jid = contact?.phone_jid || contact?.jid || `${phone}@s.whatsapp.net`

  const text =
    purpose === "signup"
      ? `Seu código de verificação SM Confecções: *${code}*\n\nVale por ${CODE_TTL_MINUTES} minutos. Não compartilhe com ninguém.`
      : `Seu código pra redefinir a senha: *${code}*\n\nVale por ${CODE_TTL_MINUTES} minutos. Não compartilhe com ninguém.`

  try {
    await sendWhatsApp(jid, text)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Não foi possível enviar o código agora." }
  }
  return { ok: true }
}

export async function consumeOtp(
  phone: string,
  code: string,
  purpose: OtpPurpose
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { rows } = await pool.query(
    `SELECT id, code, attempts, expires_at FROM whatsapp_otp_codes
     WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose]
  )
  const row = rows[0]
  if (!row) return { ok: false, error: "Código não encontrado. Peça um novo." }
  if (new Date(row.expires_at) < new Date()) return { ok: false, error: "Código expirado. Peça um novo." }
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Muitas tentativas. Peça um novo código." }

  if (row.code !== code) {
    await pool.query(`UPDATE whatsapp_otp_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id])
    return { ok: false, error: "Código incorreto." }
  }

  await pool.query(`UPDATE whatsapp_otp_codes SET consumed_at = NOW() WHERE id = $1`, [row.id])
  return { ok: true }
}
