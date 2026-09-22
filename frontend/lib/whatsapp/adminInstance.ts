import { pool } from "@/lib/db"

// Nome da instância Evolution dedicada aos administradores (ver
// app/api/whatsapp/admin-instance/route.ts, criada em 2026-09-20) — quem
// precisa mandar mensagem por ela (grupos Financeiro, Marketplace etc.)
// busca esse valor em vez de assumir um nome fixo.
export async function getAdminInstanceName(): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'admin_instance_name'`
  ).catch(() => ({ rows: [] as { value: string }[] }))
  return rows[0]?.value ?? null
}
