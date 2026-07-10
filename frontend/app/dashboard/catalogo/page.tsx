"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import Image from "next/image"
import { Upload, Trash2, ImagePlus, Loader2, AlertCircle, X, ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react"
import type { CatalogProduct } from "@/components/landing/CatalogCarousel"

type Slot = { file: File | null; preview: string; color: string }
type EditingProduct = CatalogProduct & { pendingRemove: string[] }

const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
const colorCls = "w-full border border-[#0F1E3C]/12 rounded-lg px-2 py-1.5 text-xs text-[#0F1E3C] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30 focus:border-[#4361EE] transition-colors placeholder:text-[#0F1E3C]/30 mt-1.5"

function emptySlot(): Slot { return { file: null, preview: "", color: "" } }

export default function CatalogoPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState("")

  // Add form
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [cover, setCover] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState("")
  const [coverColor, setCoverColor] = useState("")
  const [slots, setSlots] = useState<Slot[]>([emptySlot()])
  const [dragging, setDragging] = useState(false)
  const coverRef = useRef<HTMLInputElement>(null)

  // Edit modal
  const [editing, setEditing] = useState<EditingProduct | null>(null)
  const [editName, setEditName] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editCoverColor, setEditCoverColor] = useState("")
  const [editSlots, setEditSlots] = useState<Slot[]>([emptySlot()])
  const [editSaving, setEditSaving] = useState(false)
  const [modalImg, setModalImg] = useState(0)

  // Reorder (drag and drop)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)

  async function fetchProducts() {
    try {
      const res = await fetch("/api/catalog")
      if (res.ok) setProducts(await res.json())
    } catch { /* silencioso */ }
  }

  useEffect(() => { fetchProducts() }, [])

  // Whenever last slot gets a file, append a new empty slot
  function setSlotFile(idx: number, f: File, target: Slot[], setter: (s: Slot[]) => void) {
    const next = [...target]
    next[idx] = { ...next[idx], file: f, preview: URL.createObjectURL(f) }
    if (idx === next.length - 1) next.push(emptySlot())
    setter(next)
  }

  function setSlotColor(idx: number, color: string, target: Slot[], setter: (s: Slot[]) => void) {
    const next = [...target]
    next[idx] = { ...next[idx], color }
    setter(next)
  }

  function removeSlot(idx: number, target: Slot[], setter: (s: Slot[]) => void) {
    const next = target.filter((_, i) => i !== idx)
    // Always keep at least one empty slot
    if (next.length === 0 || next[next.length - 1].file !== null) next.push(emptySlot())
    setter(next)
  }

  function handleCover(f: File) {
    if (!f.type.startsWith("image/")) return
    setCover(f); setCoverPreview(URL.createObjectURL(f))
  }

  async function handleAdd() {
    if (!name.trim() || !cover) return
    setLoading(true); setError("")
    try {
      const form = new FormData()
      form.append("name", name.trim())
      form.append("description", description.trim())
      form.append("cover", cover)
      form.append("cover_color", coverColor.trim())
      slots.filter((s) => s.file).forEach((s, i) => {
        form.append(`image_${i}`, s.file!)
        form.append(`color_${i}`, s.color.trim())
      })
      const res = await fetch("/api/catalog", { method: "POST", body: form })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      const created = await res.json()
      setProducts((p) => [...p, created])
      setName(""); setDescription(""); setCoverColor("")
      setCover(null); setCoverPreview("")
      setSlots([emptySlot()])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar")
    } finally { setLoading(false) }
  }

  async function handleReorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const reordered = [...products]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    setProducts(reordered)
    setSavingOrder(true)
    try {
      await Promise.all(
        reordered.map((p, i) =>
          p.display_order === i ? null : fetch(`/api/catalog/${p.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_order: i }),
          })
        )
      )
      setProducts(reordered.map((p, i) => ({ ...p, display_order: i })))
    } finally { setSavingOrder(false) }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await fetch(`/api/catalog/${id}`, { method: "DELETE" })
      setProducts((p) => p.filter((x) => x.id !== id))
    } finally { setDeleting(null) }
  }

  function openEdit(p: CatalogProduct) {
    setEditing({ ...p, pendingRemove: [] })
    setEditName(p.name)
    setEditDesc(p.description ?? "")
    setEditCoverColor(p.cover_color ?? "")
    setEditSlots([emptySlot()])
    setModalImg(0)
  }

  function removeEditExisting(imgId: string) {
    if (!editing) return
    setEditing({ ...editing, images: editing.images?.filter((i) => i.id !== imgId) ?? [], pendingRemove: [...editing.pendingRemove, imgId] })
    setModalImg(0)
  }

  async function handleSaveEdit() {
    if (!editing || !editName.trim()) return
    setEditSaving(true)
    try {
      const form = new FormData()
      form.append("name", editName.trim())
      form.append("description", editDesc.trim())
      form.append("cover_color", editCoverColor.trim())
      if (editing.pendingRemove.length > 0) form.append("remove_images", editing.pendingRemove.join(","))
      editSlots.filter((s) => s.file).forEach((s, i) => {
        form.append(`image_${i}`, s.file!)
        form.append(`color_${i}`, s.color.trim())
      })
      const res = await fetch(`/api/catalog/${editing.id}`, { method: "PUT", body: form })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro") }
      const updated = await res.json()
      setProducts((p) => p.map((x) => x.id === updated.id ? updated : x))
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar")
    } finally { setEditSaving(false) }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
          Produtos na Landing Page
        </h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">
          Capa obrigatória + variações de cor ilimitadas. Clique em uma variação preenchida para liberar a próxima.
        </p>
      </div>

      {/* Add form */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6">
        <h2 className="text-sm font-bold text-[#0F1E3C] mb-5">Adicionar produto</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Photos */}
          <div className="space-y-5">
            {/* Cover */}
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">
                Foto de capa <span className="normal-case text-[#0F1E3C]/30">(aparece no carrossel da LP)</span>
              </label>
              <div
                className={`relative border-2 border-dashed rounded-2xl aspect-square flex flex-col items-center justify-center cursor-pointer transition-all ${dragging ? "border-[#4361EE] bg-[#4361EE]/5" : "border-[#0F1E3C]/15 hover:border-[#4361EE]/40 bg-[#F4F6FB]"}`}
                onClick={() => coverRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleCover(f) }}
              >
                {coverPreview ? (
                  <>
                    <Image src={coverPreview} alt="capa" fill className="object-cover rounded-2xl" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setCover(null); setCoverPreview("") }}
                      className="absolute top-2 right-2 w-7 h-7 bg-black/50 text-white rounded-lg flex items-center justify-center hover:bg-black/70 transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-[#0F1E3C]/30 p-6 text-center">
                    <ImagePlus size={36} />
                    <div><p className="text-sm font-semibold">Clique ou arraste</p><p className="text-xs mt-0.5">JPG, PNG, WEBP</p></div>
                  </div>
                )}
              </div>
              <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCover(f); e.target.value = "" }} />
              <input value={coverColor} onChange={(e) => setCoverColor(e.target.value)} placeholder="Cor da capa (ex: Branco)" className={colorCls} />
            </div>

            {/* Dynamic variation slots */}
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">
                Variações de cor <span className="normal-case text-[#0F1E3C]/30">(sem limite — preencha e o próximo libera)</span>
              </label>
              <DynamicSlots
                slots={slots}
                onFile={(idx, f) => setSlotFile(idx, f, slots, setSlots)}
                onColor={(idx, c) => setSlotColor(idx, c, slots, setSlots)}
                onRemove={(idx) => removeSlot(idx, slots, setSlots)}
              />
            </div>
          </div>

          {/* Info + action */}
          <div className="flex flex-col h-full gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">Nome do produto</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Camiseta Básica" onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }} disabled={loading} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">
                Descrição <span className="normal-case text-[#0F1E3C]/30">(respeita quebras de linha)</span>
              </label>
              <textarea className={`${inputCls} resize-none`} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={"Material: 100% algodão\nTamanhos: P ao GG\nProdução sob encomenda"} disabled={loading} />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-100 px-3 py-2.5 rounded-xl">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}

            <button onClick={handleAdd} disabled={!name.trim() || !cover || loading}
              className="mt-auto flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-bold py-3 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {loading ? <><Loader2 size={16} className="animate-spin" />Enviando...</> : <><Upload size={16} />Adicionar ao catálogo</>}
            </button>
          </div>
        </div>
      </div>

      {/* Product list */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-sm font-bold text-[#0F1E3C]">
            Produtos no catálogo <span className="text-[#0F1E3C]/35 font-normal">({products.length})</span>
          </h2>
          {products.length > 1 && (
            <span className="text-xs text-[#0F1E3C]/35">— arraste os cards pra mudar a ordem</span>
          )}
          {savingOrder && <Loader2 size={13} className="animate-spin text-[#4361EE]" />}
        </div>

        {products.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-[#0F1E3C]/10 py-16 text-center text-[#0F1E3C]/25">
            <ImagePlus size={36} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum produto no catálogo ainda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {products.map((p, index) => {
              const colors = [p.cover_color, ...(p.images?.map((i) => i.color) ?? [])].filter(Boolean) as string[]
              return (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) handleReorder(dragIndex, index); setDragIndex(null) }}
                  onDragEnd={() => setDragIndex(null)}
                  className={`bg-white rounded-2xl border overflow-hidden group shadow-sm hover:shadow-md transition-shadow cursor-move ${
                    dragIndex === index ? "border-[#4361EE] opacity-50" : "border-[#0F1E3C]/8"
                  }`}
                >
                  <div className="relative aspect-square bg-[#F4F6FB]">
                    <Image src={p.image_url} alt={p.name} fill className="object-cover" sizes="(max-width: 640px) 50vw, 25vw" />
                    <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(p)} className="w-7 h-7 bg-white text-[#0F1E3C] rounded-lg flex items-center justify-center shadow hover:bg-[#F4F6FB] transition-colors">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => handleDelete(p.id)} disabled={deleting === p.id} className="w-7 h-7 bg-red-500 text-white rounded-lg flex items-center justify-center hover:bg-red-600 disabled:opacity-60 transition-colors">
                        {deleting === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                    {(p.images?.length ?? 0) > 0 && (
                      <div className="absolute bottom-2 left-2 bg-black/50 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                        +{p.images!.length}
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-xs font-bold text-[#0F1E3C] truncate">{p.name}</p>
                    {colors.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {colors.slice(0, 3).map((c, i) => (
                          <span key={i} className="text-[9px] font-semibold px-1.5 py-0.5 bg-[#F4F6FB] border border-[#0F1E3C]/10 rounded-full text-[#0F1E3C]/60">{c}</span>
                        ))}
                        {colors.length > 3 && <span className="text-[9px] text-[#0F1E3C]/35">+{colors.length - 3}</span>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
              <h2 className="text-base font-bold text-[#0F1E3C]">Editar produto</h2>
              <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-xl bg-[#F4F6FB] hover:bg-[#E8EBF4] flex items-center justify-center text-[#0F1E3C]/50 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Existing photos carousel */}
              {(() => {
                const allImgs = [
                  { id: "cover", image_url: editing.image_url, color: editing.cover_color ?? null },
                  ...(editing.images ?? []),
                ]
                return (
                  <div>
                    <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">
                      Fotos atuais <span className="normal-case text-[#0F1E3C]/30">(clique na lixeira para remover uma variação)</span>
                    </label>
                    <div className="relative aspect-video bg-[#F4F6FB] rounded-xl overflow-hidden">
                      <Image src={allImgs[modalImg]?.image_url ?? editing.image_url} alt="preview" fill className="object-contain" />
                      {allImgs.length > 1 && (
                        <>
                          <button onClick={() => setModalImg((i) => Math.max(0, i - 1))} disabled={modalImg === 0} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 rounded-full flex items-center justify-center shadow disabled:opacity-30">
                            <ChevronLeft size={16} />
                          </button>
                          <button onClick={() => setModalImg((i) => Math.min(allImgs.length - 1, i + 1))} disabled={modalImg === allImgs.length - 1} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 rounded-full flex items-center justify-center shadow disabled:opacity-30">
                            <ChevronRight size={16} />
                          </button>
                        </>
                      )}
                      {modalImg > 0 && (
                        <button onClick={() => removeEditExisting(allImgs[modalImg].id)} className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-lg flex items-center justify-center hover:bg-red-600">
                          <Trash2 size={12} />
                        </button>
                      )}
                      {allImgs[modalImg]?.color && (
                        <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                          {allImgs[modalImg].color}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {allImgs.map((img, i) => (
                        <button key={img.id} onClick={() => setModalImg(i)} className={`relative w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${i === modalImg ? "border-[#4361EE]" : "border-transparent opacity-60 hover:opacity-100"}`}>
                          <Image src={img.image_url} alt="" fill className="object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Add new variations */}
              <div>
                <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">
                  Adicionar novas variações
                </label>
                <DynamicSlots
                  slots={editSlots}
                  onFile={(idx, f) => setSlotFile(idx, f, editSlots, setEditSlots)}
                  onColor={(idx, c) => setSlotColor(idx, c, editSlots, setEditSlots)}
                  onRemove={(idx) => removeSlot(idx, editSlots, setEditSlots)}
                  compact
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">Nome</label>
                  <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">Cor da capa</label>
                  <input className={inputCls} value={editCoverColor} onChange={(e) => setEditCoverColor(e.target.value)} placeholder="Ex: Branco" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">Descrição</label>
                <textarea className={`${inputCls} resize-none`} rows={3} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Detalhes do produto..." />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-100 px-3 py-2.5 rounded-xl">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm font-semibold text-[#0F1E3C]/60 hover:bg-[#F4F6FB] transition-colors">
                  Cancelar
                </button>
                <button onClick={handleSaveEdit} disabled={editSaving || !editName.trim()}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-bold py-2.5 rounded-xl transition-colors disabled:opacity-40">
                  {editSaving ? <><Loader2 size={15} className="animate-spin" />Salvando...</> : "Salvar alterações"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DynamicSlots({ slots, onFile, onColor, onRemove, compact = false }: {
  slots: Slot[]
  onFile: (idx: number, f: File) => void
  onColor: (idx: number, c: string) => void
  onRemove: (idx: number) => void
  compact?: boolean
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2"}`}>
      {slots.map((slot, i) => {
        const isEmpty = !slot.file
        const isLast = i === slots.length - 1

        return (
          <div key={i}>
            <div className="relative aspect-square">
              {slot.preview ? (
                <div className="relative w-full h-full rounded-xl overflow-hidden group">
                  <Image src={slot.preview} alt="" fill className="object-cover" />
                  <button
                    onClick={() => onRemove(i)}
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl transition-opacity"
                  >
                    <X size={compact ? 14 : 18} className="text-white" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => refs.current[i]?.click()}
                  className={`w-full h-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${
                    isLast && slots.filter((s) => s.file).length > 0
                      ? "border-[#4361EE]/30 bg-[#4361EE]/3 text-[#4361EE]/50 hover:border-[#4361EE]/60"
                      : "border-[#0F1E3C]/12 bg-[#F4F6FB] text-[#0F1E3C]/25 hover:border-[#4361EE]/40"
                  }`}
                >
                  {isLast && slots.filter((s) => s.file).length > 0
                    ? <><Plus size={compact ? 16 : 20} /><span className="text-[10px] font-semibold">Nova cor</span></>
                    : <><ImagePlus size={compact ? 16 : 20} /><span className="text-[10px]">Foto</span></>
                  }
                </button>
              )}
              <input
                ref={(el) => { refs.current[i] = el }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(i, f); e.target.value = "" }}
              />
            </div>
            <input
              value={slot.color}
              onChange={(e) => onColor(i, e.target.value)}
              placeholder={isEmpty && isLast ? "Cor" : `Cor ${i + 1}`}
              disabled={isEmpty}
              className={`w-full border rounded-lg px-2 py-1.5 text-xs text-[#0F1E3C] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30 focus:border-[#4361EE] transition-colors placeholder:text-[#0F1E3C]/30 mt-1.5 ${isEmpty ? "border-[#0F1E3C]/8 bg-[#F4F6FB]/50 text-[#0F1E3C]/30 cursor-not-allowed" : "border-[#0F1E3C]/12"}`}
            />
          </div>
        )
      })}
    </div>
  )
}
