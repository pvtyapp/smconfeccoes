import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// One-shot: remove @s.whatsapp.net contacts that have the same phone as a @lid contact.
// Messages are re-linked to the @lid contact before deletion.
export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Find duplicates: @s contact with same phone as a @lid contact
    const { rows: dupes } = await client.query(`
      SELECT
        lid.id   AS lid_id,
        lid.jid  AS lid_jid,
        lid.name AS lid_name,
        s.id     AS s_id,
        s.jid    AS s_jid,
        s.phone  AS phone
      FROM wa_contacts lid
      JOIN wa_contacts s
        ON s.phone = lid.phone
        AND s.phone ~ '^[0-9]{8,15}$'
        AND s.id <> lid.id
      WHERE lid.jid LIKE '%@lid'
        AND s.jid   LIKE '%@s.whatsapp.net'
    `)

    const results: { phone: string; lidJid: string; sJid: string; msgsMoved: number }[] = []

    for (const d of dupes) {
      // Move messages from @s contact → @lid contact
      const { rowCount } = await client.query(
        `UPDATE wa_messages SET contact_id = $1 WHERE contact_id = $2`,
        [d.lid_id, d.s_id]
      )

      // Delete the @s contact
      await client.query(`DELETE FROM wa_contacts WHERE id = $1`, [d.s_id])

      results.push({
        phone: d.phone,
        lidJid: d.lid_jid,
        sJid: d.s_jid,
        msgsMoved: rowCount ?? 0,
      })
    }

    await client.query("COMMIT")

    return NextResponse.json({ ok: true, cleaned: results.length, results })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}
