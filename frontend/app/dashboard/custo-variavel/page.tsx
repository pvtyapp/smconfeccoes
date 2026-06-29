"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2, Loader2, Pencil, Check, X } from "lucide-react"
import MetricCard from "@/components/cards/MetricCard"
import { formatCurrency } from "@/lib/calculations"
import { todayBR } from "@/lib/tz"

const CATEGORIES = ["Linhas", "Lanche", "Frete", "Gasolina", "Embalagem", "Material", "Manutenção", "Outros"]
const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"

type VariableCost = {
  id: number
  description: string
  category: string
  amount: string
  costDate: string
  notes: string | null
}

type EditForm = { id: number; description: string; category: string; amount: string; costDate: string; notes: string }

function getFormInit() {
  return { description: "", category: "", amount: "", costDate: todayBR(), notes: "" }
}

function monthLabel(m: string) {
  const [y, mo] = m.split("-")
  return new Date(Number(y), Number(mo) - 1).toLocaleString("pt-BR", { month: "long", year: "numeric" })
}

export default function CustoVariavelPage() {
  const [costs,    setCosts]    = useState<VariableCost[]>([])
  const [month,    setMonth]    = useState(() => todayBR().slice(0, 7))
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form,     setForm]     = useState(getFormInit)
  const [error,    setError]    = useState("")
  const [editing,  setEditing]  = useState<EditForm | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  async function load(m: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/variable-costs?month=${m}`)
      if (res.ok) setCosts(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(month) }, [month])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/variable-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description,
          category: form.category,
          amount: Number(form.amount),
          costDate: form.costDate,
          notes: form.notes || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      setShowForm(false)
      setForm(getFormInit())
      const entryMonth = form.costDate.slice(0, 7)
      setMonth(entryMonth)
      await load(entryMonth)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remover este lançamento? Essa ação não tem volta.")) return
    await fetch(`/api/variable-costs/${id}`, { method: "DELETE" })
    await load(month)
  }

  async function handleSave(id: number) {
    if (!editing) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/variable-costs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: editing.description || null,
          category: editing.category || null,
          amount: editing.amount ? Number(editing.amount) : null,
          costDate: editing.costDate || null,
          notes: editing.notes || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      setEditing(null)
      await load(month)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao salvar")
    } finally {
      setSavingEdit(false)
    }
  }

  const total = costs.reduce((s, c) => s + Number(c.amount), 0)

  const byCategory = CATEGORIES.map((cat) => ({
    cat,
    total: costs.filter((c) => c.category === cat).reduce((s, c) => s + Number(c.amount), 0),
  })).filter((x) => x.total > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Custo Variável</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Gastos avulsos do mês — linhas, lanches, fretes e outros</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-[#0F1E3C]/15 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE]"
          />
          <button onClick={() => { setShowForm(true); setError("") }} className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
            <Plus size={15} /> Lançar custo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title={`Total ${monthLabel(month)}`} value={formatCurrency(total)} color="blue" />
        <MetricCard title="Lançamentos" value={costs.length} />
        {byCategory.slice(0, 2).map(({ cat, total: t }) => (
          <MetricCard key={cat} title={cat} value={formatCurrency(t)} color="purple" />
        ))}
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6">
          <h2 className="text-sm font-bold text-[#0F1E3C] mb-5">Novo lançamento</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Descrição</label>
              <input className={inputCls} placeholder="Ex: Linhas poliéster" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Categoria</label>
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                <option value="">Selecione...</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Valor (R$)</label>
              <input className={inputCls} type="number" step="0.01" min="0.01" placeholder="0,00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Data</label>
              <input className={inputCls} type="date" value={form.costDate} onChange={(e) => setForm({ ...form, costDate: e.target.value })} required />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Observação</label>
              <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opcional" />
            </div>
            {error && <p className="md:col-span-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60">
                {saving && <Loader2 size={14} className="animate-spin" />}
                Lançar
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
                {["Data", "Descrição", "Categoria", "Valor", "Obs.", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {costs.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-sm text-[#0F1E3C]/30">Nenhum lançamento em {monthLabel(month)}</td></tr>
              ) : costs.map((c) =>
                editing?.id === c.id ? (
                  <tr key={c.id} className="bg-[#F4F6FB]">
                    <td className="px-3 py-2 w-32">
                      <input type="date" value={editing.costDate} onChange={e => setEditing({ ...editing, costDate: e.target.value })}
                        className="w-full border border-[#0F1E3C]/15 rounded-lg px-2 py-1.5 text-xs text-[#0F1E3C] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}
                        className="w-full border border-[#0F1E3C]/15 rounded-lg px-2 py-1.5 text-xs text-[#0F1E3C] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30" />
                    </td>
                    <td className="px-3 py-2">
                      <select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })}
                        className="w-full border border-[#0F1E3C]/15 rounded-lg px-2 py-1.5 text-xs text-[#0F1E3C] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30">
                        {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 w-28">
                      <input type="number" step="0.01" value={editing.amount} onChange={e => setEditing({ ...editing, amount: e.target.value })}
                        className="w-full border border-[#0F1E3C]/15 rounded-lg px-2 py-1.5 text-xs text-[#0F1E3C] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Obs."
                        className="w-full border border-[#0F1E3C]/15 rounded-lg px-2 py-1.5 text-xs text-[#0F1E3C] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30" />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => handleSave(c.id)} disabled={savingEdit}
                          className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-50">
                          {savingEdit ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        </button>
                        <button onClick={() => setEditing(null)}
                          className="p-1.5 rounded-lg bg-[#0F1E3C]/8 text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/15 transition-colors">
                          <X size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className="hover:bg-[#F4F6FB] transition-colors group">
                    <td className="px-5 py-3 text-[#0F1E3C]/60 whitespace-nowrap">
                      {new Date(c.costDate + "T12:00:00").toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{c.description}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-amber-100 text-amber-700">{c.category}</span>
                    </td>
                    <td className="px-5 py-3 font-bold text-[#4361EE]">{formatCurrency(Number(c.amount))}</td>
                    <td className="px-5 py-3 text-[#0F1E3C]/40 text-xs">{c.notes ?? "—"}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEditing({ id: c.id, description: c.description, category: c.category, amount: String(c.amount), costDate: c.costDate, notes: c.notes ?? "" })}
                          className="p-1.5 rounded-lg text-[#0F1E3C]/30 hover:text-[#4361EE] hover:bg-[#4361EE]/8 transition-colors">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-lg text-[#0F1E3C]/30 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
            {costs.length > 0 && (
              <tfoot>
                <tr className="border-t border-[#0F1E3C]/8 bg-[#F4F6FB]">
                  <td colSpan={3} className="px-5 py-3 text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-wider">Total do mês</td>
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
