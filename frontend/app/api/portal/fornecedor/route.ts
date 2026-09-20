import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { normalizePhone } from "@/lib/portal/phone"

export async function POST(req: Request) {
  try {
    const { name, phone: rawPhone, businessName, purchaseNotes } =
      await req.json() as { name: string; phone: string; businessName?: string; purchaseNotes?: string }

    const phone = normalizePhone(rawPhone ?? "")
    if (!phone) return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ error: "Informe seu nome" }, { status: 400 })

    await pool.query(
      `INSERT INTO fornecedor_solicitacoes (name, phone, business_name, purchase_notes)
       VALUES ($1, $2, $3, $4)`,
      [name.trim(), phone, businessName?.trim() || null, purchaseNotes?.trim() || null]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
