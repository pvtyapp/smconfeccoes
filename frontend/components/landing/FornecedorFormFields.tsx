"use client"

import { useState, type FormEvent } from "react"
import { Send, CheckCircle2 } from "lucide-react"
import WhatsAppInput from "@/app/portal/components/WhatsAppInput"

export default function FornecedorFormFields({ idPrefix = "forn" }: { idPrefix?: string }) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [businessName, setBusinessName] = useState("")
  const [purchaseNotes, setPurchaseNotes] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/portal/fornecedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, businessName, purchaseNotes }),
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
        <div className="w-12 h-12 rounded-full bg-[#1B8F63]/10 flex items-center justify-center">
          <CheckCircle2 size={22} className="text-[#1B8F63]" />
        </div>
        <p className="text-sm font-bold text-[#0F1E3C]">Solicitação enviada!</p>
        <p className="text-xs text-[#0F1E3C]/50 max-w-[26ch]">A gente analisa e avisa pelo WhatsApp assim que aprovar.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-name`} className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">Nome</label>
        <input
          id={`${idPrefix}-name`} type="text" required value={name} onChange={(e) => setName(e.target.value)}
          className="w-full border border-[#0F1E3C]/15 rounded-xl px-4 py-3 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
        />
      </div>
      <WhatsAppInput id={`${idPrefix}-phone`} value={phone} onChange={setPhone} />
      <div>
        <label htmlFor={`${idPrefix}-business`} className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">Nome do negócio (opcional)</label>
        <input
          id={`${idPrefix}-business`} type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)}
          className="w-full border border-[#0F1E3C]/15 rounded-xl px-4 py-3 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-notes`} className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">Com que frequência costuma comprar? (opcional)</label>
        <textarea
          id={`${idPrefix}-notes`} rows={2} value={purchaseNotes} onChange={(e) => setPurchaseNotes(e.target.value)}
          className="w-full border border-[#0F1E3C]/15 rounded-xl px-4 py-3 text-sm text-[#0F1E3C] resize-none focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
        />
      </div>

      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

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
