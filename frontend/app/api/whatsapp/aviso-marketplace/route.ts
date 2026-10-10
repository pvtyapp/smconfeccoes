import { NextResponse } from "next/server"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { getAdminInstanceName } from "@/lib/whatsapp/adminInstance"
import { getProvider } from "@/lib/whatsapp/provider"

// Grupo "SM Marketplaces" — recebe aviso colado manualmente aqui (análise
// roda fora do sistema, num agente com cron no PC, sem precisar subir pro
// Git/Vercel). Sempre pela instância admin dedicada, nunca a comercial.
const MARKETPLACE_GROUP_JID = "120363429813396969@g.us"

// Dois jeitos de chamar (PIV 10/10: mandar o zip junto com a mensagem):
//  - JSON {text}                                  → só texto (como sempre foi)
//  - multipart/form-data: text + file (1 ou mais) → texto e depois cada arquivo como documento
// A Vercel recusa corpo acima de ~4,5 MB, então o total dos arquivos fica em 4 MB.
const MAX_BYTES = 4 * 1024 * 1024

const MIME: Record<string, string> = {
  zip: "application/zip", pdf: "application/pdf", csv: "text/csv", txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
}
const mimeDe = (f: File) => f.type || MIME[f.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream"

export async function POST(req: Request) {
  try {
    let text = ""
    let files: File[] = []
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData()
      text = String(form.get("text") ?? "")
      files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0)
    } else {
      text = ((await req.json()) as { text?: string }).text ?? ""
    }

    if (!text.trim() && !files.length) {
      return NextResponse.json({ error: "Texto vazio" }, { status: 400 })
    }
    const total = files.reduce((s, f) => s + f.size, 0)
    if (total > MAX_BYTES) {
      return NextResponse.json({ error: `Arquivos com ${(total / 1024 / 1024).toFixed(1)} MB: o limite é 4 MB no total` }, { status: 413 })
    }

    const instance = await getAdminInstanceName()
    if (!instance) {
      return NextResponse.json({ error: "Instância admin (sm-admin) não configurada" }, { status: 500 })
    }

    if (text.trim()) await sendWhatsApp(MARKETPLACE_GROUP_JID, text.trim(), undefined, instance)

    const enviados: string[] = []
    if (files.length) {
      const provider = await getProvider()
      for (const f of files) {
        try {
          await provider.sendMedia(MARKETPLACE_GROUP_JID.replace("@g.us", ""), {
            mediatype: "document",
            media: Buffer.from(await f.arrayBuffer()).toString("base64"),
            mimetype: mimeDe(f),
            fileName: f.name,
            instanceName: instance,
            timeoutMs: 60_000,
          })
          enviados.push(f.name)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return NextResponse.json({
            error: `${text.trim() ? "Mensagem enviada, mas o" : "O"} arquivo ${f.name} falhou: ${msg.slice(0, 200)}`,
            arquivosEnviados: enviados,
          }, { status: 502 })
        }
      }
    }
    return NextResponse.json({ ok: true, arquivos: enviados })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
