"use client"

import { useState, type FormEvent } from "react"
import { Send, CheckCircle2 } from "lucide-react"

const CHANNELS = ["Shopee", "Mercado Livre", "TikTok", "Outros"]

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

// Sempre vive dentro do card escuro (bg-[#0F1E3C]) do AccessSection — estilo
// claro embutido direto aqui, sem depender de seletor CSS herdado do pai
// (é exatamente isso que deixou o texto/checkbox invisíveis antes: <p> e
// <button> não são pegos por um seletor `[&_label]`/`[&_input]`).
export default function FornecedorFormFields({ idPrefix = "forn" }: { idPrefix?: string }) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [channels, setChannels] = useState<string[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  function toggleChannel(c: string) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/portal/fornecedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, salesChannels: channels }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível enviar"); return }
      setSent(true)
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center text-center gap-2.5 py-6" role="status" aria-live="polite">
        <div className="w-12 h-12 rounded-full bg-[#1B8F63]/15 flex items-center justify-center">
          <CheckCircle2 size={22} className="text-[#4FCC97]" />
        </div>
        <p className="text-sm font-bold text-white">Solicitação enviada!</p>
        <p className="text-xs text-white/50 max-w-[26ch]">A gente analisa e avisa pelo WhatsApp assim que liberar seu acesso.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-name`} className="block text-xs font-semibold text-white/60 mb-1.5">Nome</label>
        <input
          id={`${idPrefix}-name`} type="text" required value={name} onChange={(e) => setName(e.target.value)}
          className="w-full border border-white/15 bg-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/40 focus:border-[#4361EE] transition-colors"
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-phone`} className="block text-xs font-semibold text-white/60 mb-1.5">WhatsApp</label>
        <input
          id={`${idPrefix}-phone`} type="tel" inputMode="numeric" required value={phone}
          onChange={(e) => setPhone(maskPhone(e.target.value))}
          placeholder="(00) 00000-0000"
          className="w-full border border-white/15 bg-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/40 focus:border-[#4361EE] transition-colors"
        />
      </div>
      <div>
        <p className="block text-xs font-semibold text-white/60 mb-1">Principais canais de venda</p>
        <p className="text-[11px] text-white/35 mb-2">Pode marcar mais de um</p>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => {
            const active = channels.includes(c)
            return (
              <button
                key={c} type="button" onClick={() => toggleChannel(c)}
                aria-pressed={active}
                className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                  active ? "bg-[#4361EE] border-[#4361EE] text-white" : "border-white/20 text-white/70 hover:bg-white/10"
                }`}
              >
                {c}
              </button>
            )
          })}
        </div>
      </div>

      {error && <p className="text-xs text-red-300" role="alert">{error}</p>}

      <button
        type="submit" disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
      >
        <Send size={15} />
        {loading ? "Enviando..." : "Solicitar acesso"}
      </button>
    </form>
  )
}
