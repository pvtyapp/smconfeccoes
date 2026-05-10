import { Pool } from "pg"

// Reutiliza o pool entre hot-reloads no dev (Next.js)
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined
}

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("railway")
      ? { rejectUnauthorized: false }
      : false,
    max: 5,
    idleTimeoutMillis: 30000,
  })
}

export const pool: Pool =
  process.env.NODE_ENV === "production"
    ? createPool()
    : (globalThis._pgPool ??= createPool())
