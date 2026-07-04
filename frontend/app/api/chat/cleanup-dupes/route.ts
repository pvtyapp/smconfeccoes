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
        lid.id          AS lid_id,
        lid.jid         AS lid_jid,
        lid.name        AS lid_name,
        s.id            AS s_id,
        s.jid           AS s_jid,
        s.phone         AS phone,
        s.name          AS s_name,
        s.profile_pic   AS s_pic
      FROM wa_contacts lid
      JOIN wa_contacts s
        ON (s.phone = lid.phone OR s.jid = lid.phone_jid)
        AND s.phone ~ '^[0-9]{8,15}$'
        AND s.id <> lid.id
      WHERE lid.jid LIKE '%@lid'
        AND s.jid   LIKE '%@s.whatsapp.net'
    `)

    const results: { phone: string; lidJid: string; sJid: string; msgsMoved: number; nameCopied: boolean }[] = []

    for (const d of dupes) {
      // 1. Copy name/profile_pic from @s → @lid before deleting
      await client.query(`
        UPDATE wa_contacts
        SET name        = COALESCE(name, $2),
            profile_pic = COALESCE(profile_pic, $3),
            phone       = CASE
                            WHEN phone IS NULL OR phone NOT SIMILAR TO '[0-9]{8,15}'
                            THEN $4
                            ELSE phone
                          END,
            phone_jid   = COALESCE(phone_jid, $5),
            updated_at  = NOW()
        WHERE id = $1
      `, [d.lid_id, d.s_name, d.s_pic, d.phone, d.s_jid])

      // 2. Move messages from @s → @lid
      const { rowCount } = await client.query(
        `UPDATE wa_messages SET contact_id = $1 WHERE contact_id = $2`,
        [d.lid_id, d.s_id]
      )

      // 3. Move orders from @s → @lid (FK: orders.contact_id)
      await client.query(
        `UPDATE orders SET contact_id = $1 WHERE contact_id = $2`,
        [d.lid_id, d.s_id]
      )

      // 4. Move dtf_pedidos from @s → @lid
      await client.query(
        `UPDATE dtf_pedidos SET contact_id = $1 WHERE contact_id = $2`,
        [d.lid_id, d.s_id]
      ).catch(() => {})

      // 5. Delete the @s contact
      await client.query(`DELETE FROM wa_contacts WHERE id = $1`, [d.s_id])

      results.push({
        phone:      d.phone,
        lidJid:     d.lid_jid,
        sJid:       d.s_jid,
        msgsMoved:  rowCount ?? 0,
        nameCopied: !d.lid_name && !!d.s_name,
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
