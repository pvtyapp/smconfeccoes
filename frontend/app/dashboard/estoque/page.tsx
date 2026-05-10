"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import MetricCard from "@/components/cards/MetricCard"
import type { BalanceRow } from "@/lib/calculations"

type Movement = {
  id: string; variantId: string; productName: string; color: string; size: string
  type: "in" | "out"; quantity: number; reason: string; createdAt: string
}

const ENTRY_REASONS = ["producao", "devolucao", "entrada_manual", "ajuste_positivo"]
const EXIT_REASONS  = ["venda_manual", "saida_manual", "perda", "defeito", "ajuste_negativo"]
const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"

const reasonLabel: Record<string, string> = {
  producao: "Produção", devolucao: "Devolução", entrada_manual: "Entrada manual",
  ajuste_positivo: "Ajuste +", venda_manual: "Venda manual", saida_manual: "Saída manual",
  perda: "Perda", defeito: "Defeito", ajuste_negativo: "Ajuste −",
}

export default function EstoquePage() {
  const [balance, setBalance] = useState<BalanceRow[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ variantId: "", type: "in" as "in" | "out", quantity: "", reason: "", notes: "" })
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    try {
      const [bRes, mRes] = await Promise.all([fetch("/api/stock/balance"), fetch("/api/stock/movements")])
      if (bRes.ok) setBalance(await bRes.json())
      if (mRes.ok) setMovements(await mRes.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/stock/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId: form.variantId, type: form.type, quantity: Number(form.quantity), reason: form.reason, notes: form.notes || null }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      setForm({ variantId: "", type: "in", quantity: "", reason: "", notes: "" })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao lançar")
    } finally {
      setSaving(false)
    }
  }

  const totalStock  = balance.reduce((a, b) => a + b.currentStock, 0)
  const critical    = balance.filter((b) => b.currentStock <= b.minStock).length
  const now         = new Date()
  const thisMonth   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const entMonth    = movements.filter((m) => m.type === "in"  && m.createdAt.startsWith(thisMonth)).reduce((a, m) => a + m.quantity, 0)
  const outMonth    = movements.filter((m) => m.type === "out" && m.createdAt.startsWith(thisMonth)).reduce((a, m) => a + m.quantity, 0)
  const reasons     = form.type === "in" ? ENTRY_REASONS : EXIT_REASONS

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Estoque</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Entrada e saída manual — histórico completo</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Estoque total"    value={`${totalStock} peças`} />
        <MetricCard title="Entradas no mês"  value={entMonth} color="green" />
        <MetricCard title="Saídas no mês"    value={outMonth} color="yellow" />
        <MetricCard title="Est. crítico"     value={critical} color={critical > 0 ? "red" : "default"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6">
          <h2 className="text-sm font-bold text-[#0F1E3C] mb-5">Lançar movimentação</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Variação</label>
              <select className={inputCls} value={form.variantId} onChange={(e) => setForm({ ...form, variantId: e.target.value })} required>
                <option value="">Selecione...</option>
                {balance.map((b) => (
                  <option key={b.variantId} value={b.variantId}>
                    {b.productName} {b.color} {b.size} (est: {b.currentStock})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Tipo</label>
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "in" | "out", reason: "" })}>
                <option value="in">Entrada</option>
                <option value="out">Saída</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Motivo</label>
              <select className={inputCls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required>
                <option value="">Selecione...</option>
                {reasons.map((r) => <option key={r} value={r}>{reasonLabel[r]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Quantidade</label>
              <input className={inputCls} type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Observação</label>
              <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opcional" />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold py-3 rounded-xl transition-colors disabled:opacity-60">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Lançar
            </button>
          </form>
        </div>

        {/* Tables */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
              <h2 className="text-sm font-bold text-[#0F1E3C]">Saldo por variação</h2>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-10"><div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#0F1E3C]/5">
                    {["Variação", "SKU", "Estoque", "Status"].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0F1E3C]/4">
                  {balance.map((b) => {
                    const crit = b.currentStock <= b.minStock
                    return (
                      <tr key={b.variantId} className="hover:bg-[#F4F6FB] transition-colors">
                        <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{b.productName} {b.color} {b.size}</td>
                        <td className="px-5 py-3 font-mono text-xs text-[#0F1E3C]/50">{b.sku}</td>
                        <td className="px-5 py-3 font-bold text-[#0F1E3C]">{b.currentStock}</td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${crit ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                            {crit ? "Crítico" : "OK"}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {balance.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-sm text-[#0F1E3C]/30">Sem variações cadastradas</td></tr>}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
              <h2 className="text-sm font-bold text-[#0F1E3C]">Últimas movimentações</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#0F1E3C]/5">
                  {["Variação", "Tipo", "Qtd", "Motivo", "Data"].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0F1E3C]/4">
                {movements.slice(0, 15).map((m) => (
                  <tr key={m.id} className="hover:bg-[#F4F6FB] transition-colors">
                    <td className="px-5 py-2.5 text-[#0F1E3C]/80">{m.productName} {m.color} {m.size}</td>
                    <td className="px-5 py-2.5">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${m.type === "in" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                        {m.type === "in" ? "Entrada" : "Saída"}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 font-bold text-[#0F1E3C]">{m.quantity}</td>
                    <td className="px-5 py-2.5 text-[#0F1E3C]/50">{reasonLabel[m.reason] ?? m.reason}</td>
                    <td className="px-5 py-2.5 text-[#0F1E3C]/40 text-xs">{new Date(m.createdAt).toLocaleDateString("pt-BR")}</td>
                  </tr>
                ))}
                {movements.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-sm text-[#0F1E3C]/30">Nenhuma movimentação</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
