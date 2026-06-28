import { default as pg } from "pg"

const DB = "postgresql://postgres:uapTSmxyAtoCjKuJOeXacEVHMrHAZVmm@turntable.proxy.rlwy.net:13450/railway"
const pool = new pg.Pool({ connectionString: DB })

const r = await pool.query(
  "UPDATE wa_contacts SET state = $1, state_data = $2 WHERE id = $3",
  ["idle", "{}", 1903]
)
console.log("reset:", r.rowCount, "rows")
await pool.end()
