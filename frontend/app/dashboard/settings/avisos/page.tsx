"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Send, Loader2 } from "lucide-react"

export default function AvisosPage() {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  async function send() {
    if (!text.trim()) return
    setSending(true)
    setFeedback(null)
    try {
      const r = await fetch("/api/whatsapp/aviso-marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
      const d = await r.json() as { ok?: boolean; error?: string }
      if (!r.ok) {
        setFeedback({ ok: false, msg: d.error ?? "Erro ao enviar" })
        return
      }
      setFeedback({ ok: true, msg: "Enviado!" })
      setText("")
    } catch {
      setFeedback({ ok: false, msg: "Erro de conexão ao enviar" })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/dashboard/settings" className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0F1E3C]/40 hover:text-[#0F1E3C] mb-2">
          <ArrowLeft size={12} /> Configurações
        </Link>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Avisos</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Cola o texto de uma análise pronta e manda pro grupo SM Marketplaces</p>
      </div>

      <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
        <div>
          <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Mensagem</label>
          <textarea
            className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 transition-colors min-h-[220px] font-mono"
            value={text}
            onChange={e => { setText(e.target.value); setFeedback(null) }}
            placeholder="Cola aqui o texto pronto da análise..."
          />
          <p className="text-[10px] text-[#0F1E3C]/30 mt-1">Vai pro grupo SM Marketplaces, pela instância administrativa dedicada (não a comercial).</p>
        </div>

        {feedback && (
          <p className={`text-xs font-semibold ${feedback.ok ? "text-emerald-600" : "text-red-600"}`}>
            {feedback.ok ? "✓ " : "⚠ "}{feedback.msg}
          </p>
        )}

        <button
          onClick={send}
          disabled={sending || !text.trim()}
          className="flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {sending ? "Enviando..." : "Enviar"}
        </button>
      </section>
    </div>
  )
}
