import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { normalizePhone } from "@/lib/portal/phone"

export async function POST(req: Request) {
  try {
    const { name, phone: rawPhone, salesChannels } =
      await req.json() as { name: string; phone: string; salesChannels?: string[] }

    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ error: "Informe seu nome" }, { status: 400 })

    const channels = Array.isArray(salesChannels) ? salesChannels.filter((c) => typeof c === "string" && c.trim()) : []

    await pool.query(
      `INSERT INTO fornecedor_solicitacoes (name, phone, sales_channels)
       VALUES ($1, $2, $3)`,
      [name.trim(), phone, channels.length ? channels : null]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
