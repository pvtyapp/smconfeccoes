import { NextResponse } from "next/server"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

export async function POST(req: Request) {
  try {
    const { jid, text, contactId } = await req.json()
    if (!jid || !text || !contactId) return NextResponse.json({ ok: false }, { status: 400 })
    await sendAndSave(contactId, jid, text)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
