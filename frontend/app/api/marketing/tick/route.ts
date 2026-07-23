import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { processCampaignBatch } from "@/lib/whatsapp/processCampaign"

export async function POST(req: Request) {
  try {
    const { campaignId } = await req.json() as { campaignId: number }
    if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 })

    await processCampaignBatch(1, campaignId)

    const { rows } = await pool.query(
      `SELECT status, sent_count AS "sentCount", total_count AS "totalCount",
              pause_reason AS "pauseReason"
       FROM marketing_campaigns WHERE id = $1`,
      [campaignId]
    )
    const camp = rows[0]
    if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 })

    return NextResponse.json({
      status: camp.status,
      done: camp.status === "sent" || camp.status === "cancelled",
      sentCount: camp.sentCount,
      totalCount: camp.totalCount,
      pauseReason: camp.pauseReason,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
