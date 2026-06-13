"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, Pencil, Power, Loader2, ChevronRight, ChevronDown, X, Trash2 } from "lucide-react"
import type { Category, Product } from "@/lib/types"

const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

// ── Category tree picker ─────────────────────────────────────────────────────

type TreeNode = Category & { children: TreeNode[] }

function buildTree(cats: Category[]): TreeNode[] {
  const ch = (pid: string): TreeNode[] =>
    cats.filter((c) => c.parentId === pid).map((c) => ({ ...c, children: ch(c.id) }))
  return cats.filter((c) => !c.parentId).map((r) => ({ ...r, children: ch(r.id) }))
}

function TreeNodeItem({ node, selected, onSelect, depth = 0 }: { node: TreeNode; selected: string | null; onSelect: (id: string) => void; depth?: number }) {
  const [open, setOpen] = useState(true)
  const hasKids = node.children.length > 0
  const active = selected === node.id
  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-1.5 rounded-lg cursor-pointer transition-colors ${active ? "bg-[#4361EE]/10 text-[#4361EE]" : "hover:bg-[#F4F6FB] text-[#0F1E3C]/70"}`}
        style={{ paddingLeft: `${12 + depth * 16}px`, paddingRight: "12px" }}
        onClick={() => onSelect(node.id)}
      >
        {hasKids
          ? <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open) }} className="w-4 h-4 flex items-center justify-center">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
          : <span className="w-4 h-4" />}
        <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${active ? "bg-[#4361EE] border-[#4361EE]" : "border-[#0F1E3C]/25"}`}>
          {active && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
        </div>
        <span className={`text-sm ${active ? "font-semibold" : ""}`}>{node.name}</span>
      </div>
      {hasKids && open && node.children.map((c) => <TreeNodeItem key={c.id} node={c} selected={selected} onSelect={onSelect} depth={depth + 1} />)}
    </div>
  )
}

function CategoryPicker({ categories, value, onChange }: { categories: Category[]; value: string | null; onChange: (id: string | null) => void }) {
  const tree = useMemo(() => buildTree(categories), [categories])
  if (!categories.length) return (
    <p className="text-xs text-[#0F1E3C]/40 px-3 py-2.5 border border-[#0F1E3C]/15 rounded-xl">
      Nenhuma categoria. Crie em <a href="/dashboard/categorias" className="text-[#4361EE] underline">Categorias</a>.
    </p>
  )
  return (
    <div className="border border-[#0F1E3C]/15 rounded-xl max-h-48 overflow-y-auto py-1.5">
      {tree.map((n) => <TreeNodeItem key={n.id} node={n} selected={value} onSelect={(id) => onChange(id === value ? null : id)} />)}
    </div>
  )
}

// ── Slot list ────────────────────────────────────────────────────────────────

function SlotList({ placeholder, values, onChange }: { placeholder: string; values: string[]; onChange: (v: string[]) => void }) {
  const slots = [...values, ""]
  function update(i: number, val: string) {
    const next = [...values]
    if (i < values.length) { if (val === "") next.splice(i, 1); else next[i] = val }
    else if (val !== "") next.push(val)
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {slots.map((slot, i) => {
        const isLast = i === slots.length - 1
        return (
          <div key={i} className="flex gap-2 items-center">
            <input className={inputCls} placeholder={placeholder} value={slot} onChange={(e) => update(i, e.target.value)} />
            {!isLast && (
              <button type="button" onClick={() => update(i, "")} className="w-8 h-8 flex items-center justify-center text-[#0F1E3C]/30 hover:text-red-500 transition-colors flex-shrink-0">
                <X size={14} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

const formInit = {
  name: "",
  categoryId: null as string | null,
  description: "",
  salePrice: "",
  costPrice: "",
  sizes: [] as string[],
  colors: [] as string[],
  chatbotEnabled: false,
  stockEnabled: false,
  precoPorMetro: false,
}

function catName(cats: Category[], id?: string | null) {
  if (!id) return "—"
  return cats.find((c) => c.id === id)?.name ?? "—"
}

export default function ProdutosPage() {
  const [products, setProducts]   = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<Product | null>(null)
  const [form, setForm]           = useState(formInit)
  const [error, setError]         = useState("")

  async function load() {
    setLoading(true)
    try {
      const [pr, cr] = await Promise.all([fetch("/api/products"), fetch("/api/categories")])
      if (pr.ok) setProducts(await pr.json())
      if (cr.ok) setCategories(await cr.json())
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function set<K extends keyof typeof formInit>(key: K, val: (typeof formInit)[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function openNew() {
    setEditing(null); setForm(formInit); setError(""); setShowForm(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setForm({
      name:           p.name,
      categoryId:     p.categoryId ?? null,
      description:    p.description ?? "",
      salePrice:      String(p.salePrice),
      costPrice:      String(p.costPrice),
      sizes:          [...(p.sizes ?? [])],
      colors:         [...(p.colors ?? [])],
      chatbotEnabled: p.chatbotEnabled ?? false,
      stockEnabled:   p.stockEnabled ?? false,
      precoPorMetro:  p.precoPorMetro ?? false,
    })
    setError(""); setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (!form.categoryId) {
      setError("Selecione uma categoria para continuar.")
      return
    }

    setSaving(true)
    try {
      const payload = {
        name:           form.name,
        categoryId:     form.categoryId,
        description:    form.description || null,
        salePrice:      parseFloat(form.salePrice) || 0,
        costPrice:      parseFloat(form.costPrice) || 0,
        sizes:          form.sizes.filter(Boolean),
        colors:         form.colors.filter(Boolean),
        chatbotEnabled: form.chatbotEnabled,
        stockEnabled:   form.stockEnabled,
        precoPorMetro:  form.precoPorMetro,
      }
      const res = await fetch(editing ? `/api/products/${editing.id}` : "/api/products", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      setShowForm(false); await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar")
    } finally { setSaving(false) }
  }

  async function toggleStatus(p: Product) {
    await fetch(`/api/products/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: p.status === "active" ? "inactive" : "active" }),
    })
    await load()
  }

  async function deleteProduct(p: Product) {
    if (!confirm(`Deletar "${p.name}"?\n\nEsta ação remove o produto e todas as suas variantes. Não pode ser desfeita.`)) return
    const res = await fetch(`/api/products/${p.id}`, { method: "DELETE" })
    if (!res.ok) {
      const d = await res.json()
      alert(d.error ?? "Erro ao deletar")
      return
    }
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Produtos</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Cadastre produtos com categorias, preços e variações</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
          <Plus size={15} /> Novo produto
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6">
          <h2 className="text-sm font-bold text-[#0F1E3C] mb-5">{editing ? "Editar produto" : "Novo produto"}</h2>
          <form onSubmit={handleSubmit} className="space-y-5">

            <Field label="Nome do produto" required>
              <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="Ex: Camiseta Básica Gola O" />
            </Field>

            <Field label="Categoria" required>
              <CategoryPicker categories={categories} value={form.categoryId} onChange={(id) => set("categoryId", id)} />
              {form.categoryId
                ? <p className="mt-1.5 text-xs text-[#4361EE] font-semibold">✓ {catName(categories, form.categoryId)}</p>
                : <p className="mt-1.5 text-xs text-red-400">Selecione uma categoria</p>}
            </Field>

            <Field label="Descrição (opcional)">
              <textarea className={inputCls + " resize-none"} rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Detalhes do produto..." />
            </Field>

            {/* Prices */}
            <div>
              <p className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-3">Preços</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Preço de custo (R$)">
                  <input className={inputCls} type="number" step="0.01" min="0" value={form.costPrice} onChange={(e) => set("costPrice", e.target.value)} placeholder="0,00" />
                </Field>
                <Field label="Preço de venda (R$)">
                  <input className={inputCls} type="number" step="0.01" min="0" value={form.salePrice} onChange={(e) => set("salePrice", e.target.value)} placeholder="0,00" />
                </Field>
              </div>
            </div>

            {/* Variations */}
            <div>
              <p className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-3">Variações</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-[#0F1E3C]/10 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-bold text-[#0F1E3C]">Tamanhos</p>
                  <SlotList placeholder="Ex: P, M, G, 38, 40..." values={form.sizes} onChange={(v) => set("sizes", v)} />
                  {form.sizes.length > 0 && <p className="text-[10px] text-[#0F1E3C]/35">{form.sizes.length} tamanho(s)</p>}
                </div>
                <div className="border border-[#0F1E3C]/10 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-bold text-[#0F1E3C]">Cores</p>
                  <SlotList placeholder="Ex: Preto, Branco, Azul..." values={form.colors} onChange={(v) => set("colors", v)} />
                  {form.colors.length > 0 && <p className="text-[10px] text-[#0F1E3C]/35">{form.colors.length} cor(es)</p>}
                </div>
              </div>
              {form.sizes.length > 0 && form.colors.length > 0 && (
                <p className="mt-2 text-xs text-[#0F1E3C]/40">
                  {form.sizes.length * form.colors.length} combinações — ex: {form.name || "Produto"}-{form.sizes[0]}-{form.colors[0]}
                </p>
              )}
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex items-center gap-3 p-4 bg-[#F4F6FB] rounded-xl border border-[#0F1E3C]/8">
                <button
                  type="button"
                  onClick={() => set("chatbotEnabled", !form.chatbotEnabled)}
                  className={`relative w-10 rounded-full transition-colors flex-shrink-0 ${form.chatbotEnabled ? "bg-[#25D366]" : "bg-[#0F1E3C]/15"}`}
                  style={{ height: "22px" }}
                >
                  <span
                    className={`absolute top-0.5 bg-white rounded-full shadow transition-transform ${form.chatbotEnabled ? "translate-x-5" : "translate-x-0.5"}`}
                    style={{ width: "18px", height: "18px" }}
                  />
                </button>
                <div>
                  <p className="text-sm font-semibold text-[#0F1E3C]">Disponível no chatbot</p>
                  <p className="text-xs text-[#0F1E3C]/45">Clientes podem pedir via WhatsApp</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-[#F4F6FB] rounded-xl border border-[#0F1E3C]/8">
                <button
                  type="button"
                  onClick={() => set("stockEnabled", !form.stockEnabled)}
                  className={`relative w-10 rounded-full transition-colors flex-shrink-0 ${form.stockEnabled ? "bg-[#4361EE]" : "bg-[#0F1E3C]/15"}`}
                  style={{ height: "22px" }}
                >
                  <span
                    className={`absolute top-0.5 bg-white rounded-full shadow transition-transform ${form.stockEnabled ? "translate-x-5" : "translate-x-0.5"}`}
                    style={{ width: "18px", height: "18px" }}
                  />
                </button>
                <div>
                  <p className="text-sm font-semibold text-[#0F1E3C]">Controle de estoque</p>
                  <p className="text-xs text-[#0F1E3C]/45">Gera variantes cores × tamanhos</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-[#F4F6FB] rounded-xl border border-[#0F1E3C]/8">
                <button
                  type="button"
                  onClick={() => set("precoPorMetro", !form.precoPorMetro)}
                  className={`relative w-10 rounded-full transition-colors flex-shrink-0 ${form.precoPorMetro ? "bg-[#7C3AED]" : "bg-[#0F1E3C]/15"}`}
                  style={{ height: "22px" }}
                >
                  <span
                    className={`absolute top-0.5 bg-white rounded-full shadow transition-transform ${form.precoPorMetro ? "translate-x-5" : "translate-x-0.5"}`}
                    style={{ width: "18px", height: "18px" }}
                  />
                </button>
                <div>
                  <p className="text-sm font-semibold text-[#0F1E3C]">Cobrar por metro</p>
                  <p className="text-xs text-[#0F1E3C]/45">PDV cobra proporcional ao tamanho</p>
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <div className="flex gap-3">
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

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/5">
                {["Nome", "Categoria", "Custo", "Venda", "Tamanhos", "Cores", "Chatbot", "Estoque", "Metro", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {products.length === 0 ? (
                <tr><td colSpan={10} className="py-12 text-center text-sm text-[#0F1E3C]/30">Nenhum produto cadastrado</td></tr>
              ) : products.map((p) => (
                <tr key={p.id} className="hover:bg-[#F4F6FB] transition-colors">
                  <td className="px-4 py-3 font-semibold text-[#0F1E3C]">{p.name}</td>
                  <td className="px-4 py-3 text-[#0F1E3C]/60 text-xs">{catName(categories, p.categoryId)}</td>
                  <td className="px-4 py-3 text-[#0F1E3C]/60 text-xs">R$ {Number(p.costPrice).toFixed(2)}</td>
                  <td className="px-4 py-3 text-[#0F1E3C]/60 text-xs">R$ {Number(p.salePrice).toFixed(2)}</td>
                  <td className="px-4 py-3 text-[#0F1E3C]/50 text-xs max-w-[100px] truncate">{p.sizes?.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-[#0F1E3C]/50 text-xs max-w-[100px] truncate">{p.colors?.join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${p.chatbotEnabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
                      {p.chatbotEnabled ? "Sim" : "Não"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${p.stockEnabled ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"}`}>
                      {p.stockEnabled ? "Ativo" : "Off"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${p.precoPorMetro ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-400"}`}>
                      {p.precoPorMetro ? "Sim" : "Não"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${p.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {p.status === "active" ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3 justify-end">
                      <button onClick={() => openEdit(p)} className="text-[#0F1E3C]/30 hover:text-[#4361EE] transition-colors" title="Editar"><Pencil size={14} /></button>
                      <button onClick={() => toggleStatus(p)} className="text-[#0F1E3C]/30 hover:text-amber-500 transition-colors" title={p.status === "active" ? "Desativar" : "Ativar"}><Power size={14} /></button>
                      <button onClick={() => deleteProduct(p)} className="text-[#0F1E3C]/30 hover:text-red-500 transition-colors" title="Deletar"><Trash2 size={14} /></button>
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
