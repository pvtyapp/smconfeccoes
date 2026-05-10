"use client"

import { useEffect, useState } from "react"
import { Plus, Power, Loader2 } from "lucide-react"
import type { Product, ProductVariant } from "@/lib/types"

const SIZES = ["PP", "P", "M", "G", "GG", "XGG", "Único"]

const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
const formInit = { productId: "", color: "", size: "", sku: "", salePrice: "", averageCost: "", minStock: "", targetStock: "" }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export default function VariacoesPage() {
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(formInit)
  const [filterProduct, setFilterProduct] = useState("")
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    try {
      const [vRes, pRes] = await Promise.all([fetch("/api/variants"), fetch("/api/products")])
      if (vRes.ok) setVariants(await vRes.json())
      if (pRes.ok) setProducts((await pRes.json()).filter((p: Product) => p.status === "active"))
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
      const res = await fetch("/api/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: form.productId, color: form.color, size: form.size, sku: form.sku,
          salePrice: Number(form.salePrice), averageCost: Number(form.averageCost),
          minStock: Number(form.minStock), targetStock: Number(form.targetStock),
        }),
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

  async function toggleStatus(v: ProductVariant) {
    const next = v.status === "active" ? "inactive" : "active"
    await fetch(`/api/variants/${v.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    })
    await load()
  }

  const filtered = variants.filter((v) => !filterProduct || v.productId === filterProduct)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Variações</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Unidade real de venda — cor + tamanho por produto</p>
        </div>
        <button onClick={() => { setShowForm(true); setError("") }} className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
          <Plus size={15} /> Nova variação
        </button>
      </div>

      {/* Filtro */}
      <div className="flex items-center gap-3">
        <select className="border border-[#0F1E3C]/15 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] bg-white" value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}>
          <option value="">Todos os produtos</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6">
          <h2 className="text-sm font-bold text-[#0F1E3C] mb-5">Nova variação</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Produto pai">
              <select className={inputCls} value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required>
                <option value="">Selecione...</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Cor">
              <input className={inputCls} placeholder="Ex: Preta" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} required />
            </Field>
            <Field label="Tamanho">
              <select className={inputCls} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} required>
                <option value="">Selecione...</option>
                {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="SKU">
              <input className={inputCls} placeholder="Ex: CAM-PRETA-M" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
            </Field>
            <Field label="Preço de venda (R$)">
              <input className={inputCls} type="number" step="0.01" min="0" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} required />
            </Field>
            <Field label="Custo médio (R$)">
              <input className={inputCls} type="number" step="0.01" min="0" value={form.averageCost} onChange={(e) => setForm({ ...form, averageCost: e.target.value })} required />
            </Field>
            <Field label="Estoque mínimo">
              <input className={inputCls} type="number" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} required />
            </Field>
            <Field label="Estoque alvo">
              <input className={inputCls} type="number" min="0" value={form.targetStock} onChange={(e) => setForm({ ...form, targetStock: e.target.value })} required />
            </Field>
            {error && <p className="md:col-span-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60">
                {saving && <Loader2 size={14} className="animate-spin" />}
                Criar variação
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
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/5">
                {["Produto", "Cor / Tam.", "SKU", "Preço", "Custo", "Est. min/alvo", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-sm text-[#0F1E3C]/30">Nenhuma variação cadastrada</td></tr>
              ) : filtered.map((v) => (
                <tr key={v.id} className="hover:bg-[#F4F6FB] transition-colors">
                  <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{v.productName}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/65">{v.color} / {v.size}</td>
                  <td className="px-5 py-3 font-mono text-xs text-[#0F1E3C]/50">{v.sku}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/65">R$ {Number(v.salePrice).toFixed(2)}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/65">R$ {Number(v.averageCost).toFixed(2)}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/50">{v.minStock} / {v.targetStock}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${v.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {v.status === "active" ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => toggleStatus(v)} className="text-[#0F1E3C]/30 hover:text-amber-500 transition-colors"><Power size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
