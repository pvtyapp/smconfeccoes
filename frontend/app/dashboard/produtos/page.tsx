"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Power, Loader2 } from "lucide-react"
import type { Product } from "@/lib/types"

const CATEGORIES = ["Camisetas", "Moletons", "Calças", "Bermudas", "Conjuntos", "Outros"]

const formInit = { name: "", category: "", description: "", defaultSalePrice: "", averageCost: "" }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  )
}

const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"

export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState(formInit)
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/products")
      if (res.ok) setProducts(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setEditing(null)
    setForm(formInit)
    setError("")
    setShowForm(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setForm({
      name: p.name, category: p.category, description: p.description ?? "",
      defaultSalePrice: String(p.defaultSalePrice), averageCost: String(p.averageCost),
    })
    setError("")
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const payload = {
        name: form.name, category: form.category, description: form.description || null,
        defaultSalePrice: Number(form.defaultSalePrice), averageCost: Number(form.averageCost),
      }
      const url  = editing ? `/api/products/${editing.id}` : "/api/products"
      const method = editing ? "PUT" : "POST"
      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      setShowForm(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar")
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(p: Product) {
    const next = p.status === "active" ? "inactive" : "active"
    await fetch(`/api/products/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    })
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Produtos</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Produtos pai — agrupam variações de cor e tamanho</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
          <Plus size={15} /> Novo produto
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6">
          <h2 className="text-sm font-bold text-[#0F1E3C] mb-5">{editing ? "Editar produto" : "Novo produto"}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome">
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label="Categoria">
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                <option value="">Selecione...</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Descrição">
              <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Opcional" />
            </Field>
            <Field label="Preço de venda padrão (R$)">
              <input className={inputCls} type="number" step="0.01" min="0" value={form.defaultSalePrice} onChange={(e) => setForm({ ...form, defaultSalePrice: e.target.value })} required />
            </Field>
            <Field label="Custo médio (R$)">
              <input className={inputCls} type="number" step="0.01" min="0" value={form.averageCost} onChange={(e) => setForm({ ...form, averageCost: e.target.value })} required />
            </Field>
            {error && <p className="md:col-span-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60">
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editing ? "Salvar" : "Criar produto"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm font-semibold text-[#0F1E3C]/50 hover:text-[#0F1E3C] px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 hover:border-[#0F1E3C]/20 transition-colors">
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
                {["Nome", "Categoria", "Preço venda", "Custo médio", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {products.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-sm text-[#0F1E3C]/30">Nenhum produto cadastrado</td></tr>
              ) : products.map((p) => (
                <tr key={p.id} className="hover:bg-[#F4F6FB] transition-colors">
                  <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{p.name}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/60">{p.category}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/60">R$ {Number(p.defaultSalePrice).toFixed(2)}</td>
                  <td className="px-5 py-3 text-[#0F1E3C]/60">R$ {Number(p.averageCost).toFixed(2)}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${p.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {p.status === "active" ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-3 justify-end">
                      <button onClick={() => openEdit(p)} className="text-[#0F1E3C]/30 hover:text-[#4361EE] transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => toggleStatus(p)} className="text-[#0F1E3C]/30 hover:text-amber-500 transition-colors"><Power size={14} /></button>
                    </div>
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
