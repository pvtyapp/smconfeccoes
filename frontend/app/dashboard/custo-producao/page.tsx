"use client"

import { useEffect, useState } from "react"
import { Plus, X, Loader2, Trash2 } from "lucide-react"
import { calcProductionCost, formatCurrency } from "@/lib/calculations"
import type { Product, ProductVariant } from "@/lib/types"

type Order = {
  id: string; productName: string; totalQuantity: number
  totalCost: number; unitCost: number; createdAt: string
}

type Item = { variantId: string; quantity: string }

const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"

export default function CustoProducaoPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [selectedProduct, setSelectedProduct] = useState("")
  const [items, setItems] = useState<Item[]>([{ variantId: "", quantity: "" }])
  const [fabric, setFabric] = useState({ kg: "", costPerKg: "" })
  const [sewing, setSewing] = useState("")
  const [thread, setThread] = useState("")
  const [packaging, setPackaging] = useState("")
  const [other, setOther] = useState("")
  const [notes, setNotes] = useState("")

  const productVariants = variants.filter((v) => v.productId === selectedProduct && v.status === "active")
  const salePrice = products.find((p) => p.id === selectedProduct)?.defaultSalePrice ?? 0
  const totalQty  = items.reduce((a, i) => a + (Number(i.quantity) || 0), 0)

  const calc = calcProductionCost({
    fabricKg: Number(fabric.kg) || 0, fabricCostPerKg: Number(fabric.costPerKg) || 0,
    sewingCostPerPiece: Number(sewing) || 0, threadCost: Number(thread) || 0,
    packagingCost: Number(packaging) || 0, otherCosts: Number(other) || 0,
    totalQuantity: totalQty, salePrice: Number(salePrice),
  })

  async function load() {
    setLoading(true)
    try {
      const [pRes, vRes, oRes] = await Promise.all([
        fetch("/api/products"), fetch("/api/variants"), fetch("/api/production-orders"),
      ])
      if (pRes.ok) setProducts((await pRes.json()).filter((p: Product) => p.status === "active"))
      if (vRes.ok) setVariants(await vRes.json())
      if (oRes.ok) setOrders(await oRes.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function resetForm() {
    setSelectedProduct(""); setItems([{ variantId: "", quantity: "" }])
    setFabric({ kg: "", costPerKg: "" }); setSewing(""); setThread("")
    setPackaging(""); setOther(""); setNotes("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!items.some((i) => i.variantId && i.quantity)) {
      setError("Adicione ao menos uma variação com quantidade")
      return
    }
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/production-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct || null,
          items: items.filter((i) => i.variantId && i.quantity).map((i) => ({ variantId: i.variantId, quantity: Number(i.quantity) })),
          fabricKg: Number(fabric.kg) || 0, fabricCostPerKg: Number(fabric.costPerKg) || 0,
          sewingCostPerPiece: Number(sewing) || 0, threadCost: Number(thread) || 0,
          packagingCost: Number(packaging) || 0, otherCosts: Number(other) || 0,
          totalQuantity: totalQty, totalCost: calc.totalCost, unitCost: calc.unitCost,
          notes: notes || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      resetForm()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/production-orders/${id}`, { method: "DELETE" })
    await load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Custo de Produção</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Lance produções e calcule o custo por peça em tempo real</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-5">
          <h2 className="text-sm font-bold text-[#0F1E3C]">Nova produção</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Produto</label>
              <select className={inputCls} value={selectedProduct} onChange={(e) => { setSelectedProduct(e.target.value); setItems([{ variantId: "", quantity: "" }]) }}>
                <option value="">Selecione o produto (opcional)...</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider">Variações produzidas</label>
                <button type="button" onClick={() => setItems([...items, { variantId: "", quantity: "" }])} className="text-xs font-semibold text-[#4361EE] hover:text-[#3451D4]">
                  <Plus size={13} className="inline mr-1" />Adicionar variação
                </button>
              </div>
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-2 mb-2">
                  <select className={`flex-1 ${inputCls}`} value={item.variantId} onChange={(e) => setItems(items.map((it, i) => i === idx ? { ...it, variantId: e.target.value } : it))} required>
                    <option value="">Selecione a variação...</option>
                    {(selectedProduct ? productVariants : variants.filter((v) => v.status === "active")).map((v) => (
                      <option key={v.id} value={v.id}>{v.productName} — {v.color} / {v.size}</option>
                    ))}
                  </select>
                  <input type="number" placeholder="Qtd" className="w-24 border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" value={item.quantity} onChange={(e) => setItems(items.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))} required min="1" />
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-[#0F1E3C]/30 hover:text-red-500 transition-colors"><X size={16} /></button>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Kg de tecido", val: fabric.kg, set: (v: string) => setFabric({ ...fabric, kg: v }), step: "0.001" },
                { label: "Custo/kg (R$)", val: fabric.costPerKg, set: (v: string) => setFabric({ ...fabric, costPerKg: v }), step: "0.01" },
                { label: "Custo costura/peça (R$)", val: sewing, set: setSewing, step: "0.01" },
                { label: "Custo linha (R$)", val: thread, set: setThread, step: "0.01" },
                { label: "Custo embalagem (R$)", val: packaging, set: setPackaging, step: "0.01" },
                { label: "Outros custos (R$)", val: other, set: setOther, step: "0.01" },
              ].map(({ label, val, set, step }) => (
                <div key={label}>
                  <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">{label}</label>
                  <input className={inputCls} type="number" step={step} min="0" placeholder="0" value={val} onChange={(e) => set(e.target.value)} />
                </div>
              ))}
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">Observações</label>
              <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold py-3 rounded-xl transition-colors disabled:opacity-60">
              {saving && <Loader2 size={14} className="animate-spin" />}
              Salvar produção e atualizar estoque
            </button>
          </form>
        </div>

        {/* Resumo */}
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 h-fit">
          <h2 className="text-sm font-bold text-[#0F1E3C] mb-5">Resumo do cálculo</h2>
          <div className="space-y-3 text-sm">
            {[
              { label: "Qtd total", val: `${totalQty} peças`, bold: false },
              { label: "Custo tecido", val: formatCurrency(calc.totalFabric) },
              { label: "Custo costura", val: formatCurrency(calc.totalSewing) },
              { label: "Linha", val: formatCurrency(Number(thread) || 0) },
              { label: "Embalagem", val: formatCurrency(Number(packaging) || 0) },
              { label: "Outros", val: formatCurrency(Number(other) || 0) },
            ].map(({ label, val }) => (
              <div key={label} className="flex justify-between">
                <span className="text-[#0F1E3C]/50">{label}</span>
                <span className="text-[#0F1E3C]/80">{val}</span>
              </div>
            ))}
            <div className="border-t border-[#0F1E3C]/6 pt-3 space-y-2">
              <div className="flex justify-between font-black">
                <span className="text-[#0F1E3C]">Custo total</span>
                <span className="text-[#4361EE]">{formatCurrency(calc.totalCost)}</span>
              </div>
              <div className="flex justify-between font-black">
                <span className="text-[#0F1E3C]">Custo/peça</span>
                <span className="text-[#4361EE]">{formatCurrency(calc.unitCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#0F1E3C]/50">Preço venda</span>
                <span>{formatCurrency(Number(salePrice))}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-[#0F1E3C]">Lucro/peça</span>
                <span className={calc.unitProfit >= 0 ? "text-emerald-600" : "text-red-600"}>{formatCurrency(calc.unitProfit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#0F1E3C]/50">Margem</span>
                <span className={calc.marginPercent >= 0 ? "text-emerald-600" : "text-red-600"}>{calc.marginPercent.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Histórico */}
      {!loading && orders.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0F1E3C]/6">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Histórico de produções</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/5">
                {["Produto", "Qtd", "Custo total", "Custo/peça", "Data", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-[#F4F6FB] transition-colors">
                  <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{o.productName ?? "—"}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/65">{o.totalQuantity} peças</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/65">{formatCurrency(Number(o.totalCost))}</td>
                  <td className="px-5 py-3 font-bold text-[#4361EE]">{formatCurrency(Number(o.unitCost))}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/40 text-xs">{new Date(o.createdAt).toLocaleDateString("pt-BR")}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => handleDelete(o.id)} className="text-[#0F1E3C]/30 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
