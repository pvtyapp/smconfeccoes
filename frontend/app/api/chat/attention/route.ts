import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/chat/attention
// body: { contactId, action: 'dismiss' | 'pause_temp' | 'pause_perm' }
//
// dismiss    → remove alert, return bot to idle
// pause_temp → silence bot for 12h (keeps needs_attention = false)
// pause_perm → disable chatbot permanently for this contact
export async function POST(req: Request) {
  try {
    const { contactId, action } = await req.json()
    if (!contactId || !action) return NextResponse.json({ error: "contactId e action obrigatórios" }, { status: 400 })

    if (action === "dismiss") {
      await pool.query(`
        UPDATE wa_contacts
        SET needs_attention = false, attention_reason = NULL, state = 'idle', state_data = '{}', updated_at = NOW()
        WHERE id = $1
      `, [contactId])

    } else if (action === "pause_temp") {
      await pool.query(`
        UPDATE wa_contacts
        SET chatbot_paused_until = NOW() + INTERVAL '12 hours', updated_at = NOW()
        WHERE id = $1
      `, [contactId])

    } else if (action === "pause_perm") {
      await pool.query(`
        UPDATE wa_contacts
        SET chatbot_produto_enabled = false, chatbot_dtf_enabled = false,
            needs_attention = false, updated_at = NOW()
        WHERE id = $1
      `, [contactId])

    } else {
      return NextResponse.json({ error: "action inválida" }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
