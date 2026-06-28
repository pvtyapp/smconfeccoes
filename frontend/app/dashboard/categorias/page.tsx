"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Trash2, ChevronRight, Loader2 } from "lucide-react"
import type { Category } from "@/lib/types"

const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"

type AddMode = { level: "root" } | { level: "child"; parentId: string } | { level: "sub"; parentId: string }

function buildTree(cats: Category[]) {
  const roots = cats.filter((c) => !c.parentId)
  const children = (parentId: string) => cats.filter((c) => c.parentId === parentId)
  return roots.map((r) => ({
    ...r,
    children: children(r.id).map((ch) => ({ ...ch, children: children(ch.id) })),
  }))
}

export default function CategoriasPage() {
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [addMode, setAddMode] = useState<AddMode | null>(null)
  const [addName, setAddName] = useState("")

  const [editing, setEditing] = useState<Category | null>(null)
  const [editName, setEditName] = useState("")

  const [error, setError] = useState("")
  const [deleting, setDeleting] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/categories")
      if (res.ok) setCats(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addName.trim() || !addMode) return
    setSaving(true)
    setError("")
    try {
      const parentId = addMode.level === "root" ? null : addMode.parentId
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName.trim(), parentId }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setAddMode(null)
      setAddName("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro")
    } finally {
      setSaving(false)
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    if (!editing || !editName.trim()) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/categories/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setEditing(null)
      setEditName("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar esta categoria e todas as filhas?")) return
    setDeleting(id)
    setError("")
    try {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? "Erro ao apagar. Verifique se há produtos vinculados.")
        return
      }
      await load()
    } catch {
      setError("Erro ao apagar")
    } finally {
      setDeleting(null)
    }
  }

  function openEdit(cat: Category) {
    setEditing(cat)
    setEditName(cat.name)
    setError("")
  }

  const tree = buildTree(cats)

  const levelLabel: Record<string, string> = {
    root: "categoria raiz",
    child: "categoria filha",
    sub: "subcategoria",
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Categorias</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Árvore de 3 níveis: Raiz → Filha → Subcategoria</p>
        </div>
        <button
          onClick={() => { setAddMode({ level: "root" }); setAddName(""); setError("") }}
          className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          <Plus size={15} /> Nova raiz
        </button>
      </div>

      {/* Add/Edit form */}
      {(addMode || editing) && (
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
          {addMode && (
            <form onSubmit={handleAdd} className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">
                  Nova {levelLabel[addMode.level]}
                </label>
                <input
                  className={inputCls}
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Nome..."
                  autoFocus
                  required
                />
              </div>
              <button type="submit" disabled={saving} className="flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap">
                {saving && <Loader2 size={14} className="animate-spin" />} Criar
              </button>
              <button type="button" onClick={() => { setAddMode(null); setError("") }} className="text-sm font-semibold text-[#0F1E3C]/50 hover:text-[#0F1E3C] px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 transition-colors">
                Cancelar
              </button>
            </form>
          )}
          {editing && (
            <form onSubmit={handleRename} className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5">
                  Renomear "{editing.name}"
                </label>
                <input
                  className={inputCls}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <button type="submit" disabled={saving} className="flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap">
                {saving && <Loader2 size={14} className="animate-spin" />} Salvar
              </button>
              <button type="button" onClick={() => { setEditing(null); setError("") }} className="text-sm font-semibold text-[#0F1E3C]/50 hover:text-[#0F1E3C] px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 transition-colors">
                Cancelar
              </button>
            </form>
          )}
          {error && <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        </div>
      )}

      {error && !addMode && !editing && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-xl border border-red-200">{error}</p>
      )}

      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tree.length === 0 ? (
          <div className="py-14 text-center text-sm text-[#0F1E3C]/30">
            Nenhuma categoria. Crie a primeira raiz.
          </div>
        ) : (
          <div className="divide-y divide-[#0F1E3C]/4">
            {tree.map((root) => (
              <div key={root.id}>
                {/* Root */}
                <div className="flex items-center gap-2 px-5 py-3 hover:bg-[#F4F6FB] group">
                  <span className="font-bold text-sm text-[#0F1E3C] flex-1">{root.name}</span>
                  <button
                    onClick={() => { setAddMode({ level: "child", parentId: root.id }); setAddName(""); setEditing(null); setError("") }}
                    className="opacity-0 group-hover:opacity-100 text-[10px] font-semibold text-[#4361EE] border border-[#4361EE]/30 px-2 py-1 rounded-lg hover:bg-[#4361EE]/5 transition-all whitespace-nowrap"
                  >
                    + filha
                  </button>
                  <button onClick={() => { openEdit(root); setAddMode(null) }} className="opacity-0 group-hover:opacity-100 text-[#0F1E3C]/30 hover:text-[#4361EE] transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(root.id)} disabled={!!deleting} className="opacity-0 group-hover:opacity-100 text-[#0F1E3C]/30 hover:text-red-500 transition-colors disabled:opacity-40">
                    {deleting === root.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>

                {/* Children */}
                {root.children.map((child) => (
                  <div key={child.id}>
                    <div className="flex items-center gap-2 px-5 py-2.5 pl-10 hover:bg-[#F4F6FB] group border-t border-[#0F1E3C]/3">
                      <ChevronRight size={12} className="text-[#0F1E3C]/25 flex-shrink-0" />
                      <span className="text-sm text-[#0F1E3C]/80 flex-1">{child.name}</span>
                      <button
                        onClick={() => { setAddMode({ level: "sub", parentId: child.id }); setAddName(""); setEditing(null); setError("") }}
                        className="opacity-0 group-hover:opacity-100 text-[10px] font-semibold text-[#4361EE] border border-[#4361EE]/30 px-2 py-1 rounded-lg hover:bg-[#4361EE]/5 transition-all whitespace-nowrap"
                      >
                        + sub
                      </button>
                      <button onClick={() => { openEdit(child); setAddMode(null) }} className="opacity-0 group-hover:opacity-100 text-[#0F1E3C]/30 hover:text-[#4361EE] transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(child.id)} disabled={!!deleting} className="opacity-0 group-hover:opacity-100 text-[#0F1E3C]/30 hover:text-red-500 transition-colors disabled:opacity-40">
                        {deleting === child.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>

                    {/* Subcategories */}
                    {child.children.map((sub) => (
                      <div key={sub.id} className="flex items-center gap-2 px-5 py-2 pl-16 hover:bg-[#F4F6FB] group border-t border-[#0F1E3C]/3">
                        <ChevronRight size={10} className="text-[#0F1E3C]/20 flex-shrink-0" />
                        <ChevronRight size={10} className="text-[#0F1E3C]/20 flex-shrink-0 -ml-2.5" />
                        <span className="text-xs text-[#0F1E3C]/60 flex-1">{sub.name}</span>
                        <button onClick={() => { openEdit(sub); setAddMode(null) }} className="opacity-0 group-hover:opacity-100 text-[#0F1E3C]/30 hover:text-[#4361EE] transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(sub.id)} disabled={!!deleting} className="opacity-0 group-hover:opacity-100 text-[#0F1E3C]/30 hover:text-red-500 transition-colors disabled:opacity-40">
                          {deleting === sub.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
