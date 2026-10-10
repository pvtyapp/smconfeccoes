import { NextResponse } from "next/server"
import { createHmac } from "crypto"
import { getAdminInstanceName } from "@/lib/whatsapp/adminInstance"

// Arquivo grande (até 150 MB) não passa pela Vercel (corpo máx. ~4,5 MB). O navegador manda direto pro
// smconfeccoes-backend (Railway) com este token curto, assinado com UPLOAD_SECRET (o mesmo do backend).
// O token já diz o destino (grupo SM Marketplaces) e a instância admin — o backend não decide nada.
// Mesma sessão do painel (o middleware barra sem login).
const MARKETPLACE_GROUP_JID = "120363429813396969@g.us"
const BACKEND_URL = process.env.SM_BACKEND_URL || "https://smconfeccoes-backend-production.up.railway.app"

export async function POST() {
  const secret = process.env.UPLOAD_SECRET
  if (!secret) return NextResponse.json({ error: "UPLOAD_SECRET não configurado" }, { status: 500 })
  const instance = await getAdminInstanceName()
  if (!instance) return NextResponse.json({ error: "Instância admin (sm-admin) não configurada" }, { status: 500 })

  const corpo = Buffer.from(JSON.stringify({
    jid: MARKETPLACE_GROUP_JID,
    instance,
    exp: Math.floor(Date.now() / 1000) + 30 * 60,   // 30 min: dá pra subir 150 MB numa internet lenta
  })).toString("base64url")
  const assinatura = createHmac("sha256", secret).update(corpo).digest("base64url")
  return NextResponse.json({ token: `${corpo}.${assinatura}`, url: `${BACKEND_URL}/whatsapp/arquivo`, maxBytes: 150 * 1024 * 1024 })
}
