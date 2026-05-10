"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { storageGet, storageSet } from "@/lib/storage"
import { MOCK_OPERATIONAL_COSTS } from "@/lib/mock-data"
import type { OperationalCost } from "@/lib/types"
import { calcMonthlyOperationalCost, formatCurrency } from "@/lib/calculations"
import MetricCard from "@/components/cards/MetricCard"
import { Plus, Power } from "lucide-react"

const CATEGORIES = ["Costureiras", "Linhas", "Energia", "Aluguel", "Corte", "Embalagem", "Internet", "Manutenção", "Transporte", "Outros"]

function getCosts(): OperationalCost[] { return storageGet<OperationalCost[]>("opcosts") ?? MOCK_OPERATIONAL_COSTS }

export default function CustoOperacionalPage() {
  const [costs, setCosts] = useState<OperationalCost[]>(getCosts)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: "", category: "Outros", type: "fixed" as "fixed" | "variable", monthlyValue: "", notes: "" })

  function saveCosts(list: OperationalCost[]) { setCosts(list); storageSet("opcosts", list) }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const novo: OperationalCost = {
      id: `oc${Date.now()}`,
      name: form.name,
      category: form.category,
      type: form.type,
      monthlyValue: Number(form.monthlyValue),
      active: true,
      notes: form.notes,
    }
    saveCosts([...costs, novo])
    setShowForm(false)
    setForm({ name: "", category: "Outros", type: "fixed", monthlyValue: "", notes: "" })
  }

  function toggleActive(id: string) { saveCosts(costs.map((c) => c.id === id ? { ...c, active: !c.active } : c)) }

  const total = calcMonthlyOperationalCost(costs)
  const totalFixed = costs.filter((c) => c.active && c.type === "fixed").reduce((a, c) => a + c.monthlyValue, 0)
  const totalVariable = costs.filter((c) => c.active && c.type === "variable").reduce((a, c) => a + c.monthlyValue, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Custo Operacional</h1>
          <p className="text-sm text-gray-500">Gastos fixos e variáveis da confecção</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="flex items-center gap-2">
          <Plus size={16} /> Novo custo
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MetricCard title="Total operacional/mês" value={formatCurrency(total)} color="blue" />
        <MetricCard title="Fixos" value={formatCurrency(totalFixed)} />
        <MetricCard title="Variáveis" value={formatCurrency(totalVariable)} />
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Novo custo</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div><Label>Nome</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div>
              <Label>Categoria</Label>
              <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label>Tipo</Label>
              <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "fixed" | "variable" })}>
                <option value="fixed">Fixo</option>
                <option value="variable">Variável</option>
              </select>
            </div>
            <div><Label>Valor mensal (R$)</Label><Input className="mt-1" type="number" step="0.01" value={form.monthlyValue} onChange={(e) => setForm({ ...form, monthlyValue: e.target.value })} required /></div>
            <div className="col-span-2"><Label>Observação</Label><Input className="mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="col-span-2 flex gap-3">
              <Button type="submit">Adicionar</Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">Nome</th>
              <th className="text-left px-5 py-3">Categoria</th>
              <th className="text-left px-5 py-3">Tipo</th>
              <th className="text-left px-5 py-3">Valor/mês</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {costs.map((c) => (
              <tr key={c.id} className={`hover:bg-gray-50 ${!c.active ? "opacity-50" : ""}`}>
                <td className="px-5 py-3 font-medium text-gray-800">{c.name}</td>
                <td className="px-5 py-3 text-gray-600">{c.category}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.type === "fixed" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                    {c.type === "fixed" ? "Fixo" : "Variável"}
                  </span>
                </td>
                <td className="px-5 py-3 font-semibold text-gray-800">{formatCurrency(c.monthlyValue)}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {c.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <button onClick={() => toggleActive(c.id)} className="text-gray-400 hover:text-yellow-600"><Power size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
