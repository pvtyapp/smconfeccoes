import { NextResponse } from "next/server"
import { sendWhatsApp } from "@/lib/whatsapp/send"

export async function POST(req: Request) {
  try {
    const { jid, text } = await req.json()
    if (!jid || !text) return NextResponse.json({ ok: false }, { status: 400 })
    await sendWhatsApp(jid, text)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
