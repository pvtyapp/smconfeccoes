import { config } from "dotenv"
config({ path: new URL("../.env.local", import.meta.url).pathname.replace(/^\/(\w):/, "$1:") })
import pg from "pg"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function main() {
  const exec = await pool.query("SELECT * FROM lifecycle_executions ORDER BY id DESC LIMIT 10")
  console.log("=== lifecycle_executions (últimos 10) ===")
  console.table(exec.rows)

  const last = await pool.query(`
    SELECT id, name, last_marketing_sent_at, lifecycle_state, novo_seq, ausente_seq
    FROM wa_contacts WHERE last_marketing_sent_at > NOW() - INTERVAL '3 hours'
    ORDER BY last_marketing_sent_at DESC LIMIT 10
  `)
  console.log("=== disparos últimas 3h ===")
  console.table(last.rows)

  console.log("agora (UTC):", new Date().toISOString())
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
