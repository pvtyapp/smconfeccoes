"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2, Loader2 } from "lucide-react"
import MetricCard from "@/components/cards/MetricCard"
import { formatCurrency, calcMonthlyOperationalCost } from "@/lib/calculations"
import type { OperationalCost } from "@/lib/types"

const CATEGORIES = ["Costureiras", "Linhas", "Energia", "Aluguel", "Corte", "Embalagem", "Internet", "Manutenção", "Transporte", "Outros"]
const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
const formInit = { name: "", category: "", type: "fixed" as "fixed" | "variable", monthlyValue: "", notes: "" }

export default function CustoOperacionalPage() {
  const [costs, setCosts] = useState<OperationalCost[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(formInit)
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/operational-costs")
      if (res.ok) setCosts(await res.json())
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
      const res = await fetch("/api/operational-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, category: form.category, type: form.type, monthlyValue: Number(form.monthlyValue), notes: form.notes || null }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      setShowForm(false)
      setForm(formInit)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar")
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(c: OperationalCost) {
    await fetch(`/api/operational-costs/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    })
    await load()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/operational-costs/${id}`, { method: "DELETE" })
    await load()
  }

  const total    = calcMonthlyOperationalCost(costs)
  const active   = costs.filter((c) => c.active)
  const inactive = costs.filter((c) => !c.active)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Custo Operacional</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Custos fixos e variáveis mensais da operação</p>
        </div>
        <button onClick={() => { setShowForm(true); setError("") }} className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
          <Plus size={15} /> Novo custo
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total mensal ativo"  value={formatCurrency(total)} color="blue" />
        <MetricCard title="Custos ativos"       value={active.length} />
        <MetricCard title="Custos inativos"     value={inactive.length} color="purple" />
        <MetricCard title="Itens cadastrados"   value={costs.length} />
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6">
          <h2 className="text-sm font-bold text-[#0F1E3C] mb-5">Novo custo operacional</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Nome</label>
              <input className={inputCls} placeholder="Ex: Costureiras" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Categoria</label>
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                <option value="">Selecione...</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Tipo</label>
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "fixed" | "variable" })}>
                <option value="fixed">Fixo</option>
                <option value="variable">Variável</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Valor mensal (R$)</label>
              <input className={inputCls} type="number" step="0.01" min="0" value={form.monthlyValue} onChange={(e) => setForm({ ...form, monthlyValue: e.target.value })} required />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Observação</label>
              <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opcional" />
            </div>
            {error && <p className="md:col-span-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60">
                {saving && <Loader2 size={14} className="animate-spin" />}
                Adicionar custo
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm font-semibold text-[#0F1E3C]/50 hover:text-[#0F1E3C] px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/5">
                {["Nome", "Categoria", "Tipo", "Valor mensal", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {costs.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-sm text-[#0F1E3C]/30">Nenhum custo cadastrado</td></tr>
              ) : costs.map((c) => (
                <tr key={c.id} className={`hover:bg-[#F4F6FB] transition-colors ${!c.active ? "opacity-50" : ""}`}>
                  <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{c.name}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/60">{c.category}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${c.type === "fixed" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                      {c.type === "fixed" ? "Fixo" : "Variável"}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-bold text-[#4361EE]">{formatCurrency(Number(c.monthlyValue))}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => toggleActive(c)} className={`text-xs px-2.5 py-1 rounded-full font-semibold transition-colors ${c.active ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                      {c.active ? "Ativo" : "Inativo"}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => handleDelete(c.id)} className="text-[#0F1E3C]/30 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            {costs.length > 0 && (
              <tfoot>
                <tr className="border-t border-[#0F1E3C]/8 bg-[#F4F6FB]">
                  <td colSpan={3} className="px-5 py-3 text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-wider">Total mensal (ativos)</td>
                  <td className="px-5 py-3 font-black text-[#0F1E3C]">{formatCurrency(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  )
}
