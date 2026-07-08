import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/chat/attention
// body: { contactId, action: 'dismiss' | 'toggle_silence' }
//
// dismiss        → remove alerta, volta bot pro idle
// toggle_silence → liga/desliga o silêncio dessa conversa (um botão só, sem prazo —
//                  fica assim até alguém apertar de novo)
export async function POST(req: Request) {
  try {
    const { contactId, action } = await req.json()
    if (!contactId || !action) return NextResponse.json({ error: "contactId e action obrigatórios" }, { status: 400 })

    await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS chatbot_silenced BOOLEAN NOT NULL DEFAULT false`).catch(() => {})

    if (action === "dismiss") {
      await pool.query(`
        UPDATE wa_contacts
        SET needs_attention = false, attention_reason = NULL, state = 'idle', state_data = '{}', updated_at = NOW()
        WHERE id = $1
      `, [contactId])
      return NextResponse.json({ ok: true })
    }

    if (action === "toggle_silence") {
      const { rows } = await pool.query(`
        UPDATE wa_contacts
        SET chatbot_silenced = NOT COALESCE(chatbot_silenced, false), updated_at = NOW()
        WHERE id = $1
        RETURNING chatbot_silenced AS "chatbotSilenced"
      `, [contactId])
      return NextResponse.json({ ok: true, chatbotSilenced: rows[0]?.chatbotSilenced ?? null })
    }

    return NextResponse.json({ error: "action inválida" }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
