import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function GET() {
  const { rows } = await pool.query(`
    SELECT id, name, chatbot_enabled AS "ativoNoCadastro", chatbot_disponivel AS "disponivel"
    FROM products
    WHERE LOWER(name) NOT LIKE '%dtf%'
      AND status = 'active'
    ORDER BY chatbot_enabled DESC, name
  `)
  return NextResponse.json(rows)
}

export async function PUT(req: Request) {
  const { id, disponivel } = await req.json() as { id: number; disponivel: boolean }
  await pool.query(
    `UPDATE products SET chatbot_disponivel = $1 WHERE id = $2`,
    [disponivel, id]
  )
  return NextResponse.json({ ok: true })
}
