import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendAndSave } from "@/lib/whatsapp/sendAndSave"

// contactId manda no jid — busca sempre o jid atual do contato no banco em vez
// de confiar no que quem chamou montou (ex: PDV construía @s.whatsapp.net a
// partir só do telefone, quebrando pra cliente já migrado pra @lid).
export async function POST(req: Request) {
  try {
    const { jid: fallbackJid, text, contactId } = await req.json()
    if (!text || (!contactId && !fallbackJid)) return NextResponse.json({ ok: false }, { status: 400 })

    let jid = fallbackJid as string | undefined
    if (contactId) {
      const { rows } = await pool.query(`SELECT jid FROM wa_contacts WHERE id = $1`, [contactId])
      if (rows[0]?.jid) jid = rows[0].jid
    }
    if (!jid) return NextResponse.json({ ok: false }, { status: 400 })

    await sendAndSave(contactId, jid, text)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
