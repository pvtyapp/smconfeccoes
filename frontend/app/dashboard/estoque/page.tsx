"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { storageGet, storageSet } from "@/lib/storage"
import { MOCK_VARIANTS, MOCK_STOCK_MOVEMENTS } from "@/lib/mock-data"
import type { StockMovement, ProductVariant } from "@/lib/types"
import { calcCurrentStock, formatCurrency } from "@/lib/calculations"
import MetricCard from "@/components/cards/MetricCard"

function getMovements(): StockMovement[] { return storageGet<StockMovement[]>("movements") ?? MOCK_STOCK_MOVEMENTS }
function getVariants(): ProductVariant[] { return storageGet<ProductVariant[]>("variants") ?? MOCK_VARIANTS }

const ENTRY_REASONS = ["entrada_manual", "producao", "devolucao", "ajuste_positivo"]
const EXIT_REASONS = ["saida_manual", "venda_manual", "perda", "defeito", "ajuste_negativo"]

export default function EstoquePage() {
  const [movements, setMovements] = useState<StockMovement[]>(getMovements)
  const variants = getVariants()
  const [form, setForm] = useState({ variantId: "", type: "in" as "in" | "out", quantity: "", reason: "", notes: "" })

  function saveMovements(list: StockMovement[]) { setMovements(list); storageSet("movements", list) }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const novo: StockMovement = {
      id: `sm${Date.now()}`,
      variantId: form.variantId,
      type: form.type,
      quantity: Number(form.quantity),
      reason: form.reason,
      channel: "manual",
      notes: form.notes,
      createdAt: new Date().toISOString().split("T")[0],
    }
    saveMovements([...movements, novo])
    setForm({ variantId: "", type: "in", quantity: "", reason: "", notes: "" })
  }

  const today = new Date().toISOString().split("T")[0]
  const thisMonth = today.slice(0, 7)
  const entriesMonth = movements.filter((m) => m.type === "in" && m.createdAt.startsWith(thisMonth)).reduce((a, m) => a + m.quantity, 0)
  const exitsMonth = movements.filter((m) => m.type === "out" && m.createdAt.startsWith(thisMonth)).reduce((a, m) => a + m.quantity, 0)
  const totalStock = variants.reduce((a, v) => a + calcCurrentStock(v.id, movements), 0)
  const critical = variants.filter((v) => calcCurrentStock(v.id, movements) <= v.minStock).length

  const reasons = form.type === "in" ? ENTRY_REASONS : EXIT_REASONS

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Estoque</h1>
        <p className="text-sm text-gray-500">Entrada e saída manual de peças</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Estoque total" value={totalStock + " peças"} />
        <MetricCard title="Entradas no mês" value={entriesMonth} color="green" />
        <MetricCard title="Saídas no mês" value={exitsMonth} color="yellow" />
        <MetricCard title="Estoque crítico" value={critical} color={critical > 0 ? "red" : "default"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Lançar movimentação</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Variação</Label>
              <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.variantId} onChange={(e) => setForm({ ...form, variantId: e.target.value })} required>
                <option value="">Selecione...</option>
                {variants.map((v) => <option key={v.id} value={v.id}>{v.productName} {v.color} {v.size}</option>)}
              </select>
            </div>
            <div>
              <Label>Tipo</Label>
              <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "in" | "out", reason: "" })}>
                <option value="in">Entrada</option>
                <option value="out">Saída</option>
              </select>
            </div>
            <div>
              <Label>Motivo</Label>
              <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required>
                <option value="">Selecione...</option>
                {reasons.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <Label>Quantidade</Label>
              <Input className="mt-1" type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
            </div>
            <div>
              <Label>Observação</Label>
              <Input className="mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button type="submit" className="w-full">Lançar</Button>
          </form>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Saldo por variação</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-5 py-3">Variação</th>
                  <th className="text-left px-5 py-3">SKU</th>
                  <th className="text-left px-5 py-3">Estoque atual</th>
                  <th className="text-left px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {variants.map((v) => {
                  const stock = calcCurrentStock(v.id, movements)
                  const isCritical = stock <= v.minStock
                  return (
                    <tr key={v.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-800">{v.productName} {v.color} {v.size}</td>
                      <td className="px-5 py-3 text-gray-500 font-mono text-xs">{v.sku}</td>
                      <td className="px-5 py-3 font-semibold text-gray-800">{stock}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isCritical ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                          {isCritical ? "Crítico" : "OK"}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Últimas movimentações</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-5 py-3">Variação</th>
                  <th className="text-left px-5 py-3">Tipo</th>
                  <th className="text-left px-5 py-3">Qtd</th>
                  <th className="text-left px-5 py-3">Motivo</th>
                  <th className="text-left px-5 py-3">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...movements].reverse().slice(0, 10).map((m) => {
                  const v = variants.find((x) => x.id === m.variantId)
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-5 py-2.5 text-gray-700">{v ? `${v.productName} ${v.color} ${v.size}` : m.variantId}</td>
                      <td className="px-5 py-2.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.type === "in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {m.type === "in" ? "Entrada" : "Saída"}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 font-semibold text-gray-800">{m.quantity}</td>
                      <td className="px-5 py-2.5 text-gray-500">{m.reason.replace(/_/g, " ")}</td>
                      <td className="px-5 py-2.5 text-gray-400">{m.createdAt}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
