"use client"

import { useEffect, useRef, useState } from "react"
import { Trash2, Loader2, ImageIcon } from "lucide-react"

type ProductImage = { id: number; color: string | null; imageUrl: string; displayOrder: number }

export default function ProductImagesManager({ productId, colors }: { productId: string; colors: string[] }) {
  const [images, setImages] = useState<ProductImage[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedColor, setSelectedColor] = useState<string>("")
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/products/${productId}/images`)
      if (res.ok) setImages(await res.json())
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [productId])

  async function handleUpload(file: File) {
    setUploading(true)
    setError("")
    try {
      const form = new FormData()
      form.append("file", file)
      if (selectedColor) form.append("color", selectedColor)
      const res = await fetch(`/api/products/${productId}/images`, { method: "POST", body: form })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erro ao subir foto") }
      const created: ProductImage = await res.json()
      setImages((prev) => [...prev, created])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao subir foto")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remover essa foto?")) return
    await fetch(`/api/products/images/${id}`, { method: "DELETE" })
    setImages((prev) => prev.filter((i) => i.id !== id))
  }

  const groups = new Map<string, ProductImage[]>()
  for (const img of images) {
    const key = img.color ?? "Todas as cores"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(img)
  }

  return (
    <div className="border border-[#0F1E3C]/10 rounded-xl p-4 space-y-4">
      <div>
        <p className="text-sm font-bold text-[#0F1E3C]">Fotos</p>
        <p className="text-xs text-[#0F1E3C]/40">
          Carrossel 1:1 — aparece igual na LP e no catálogo do cliente, é a mesma foto nos dois lugares.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {colors.length > 0 && (
          <select
            value={selectedColor}
            onChange={(e) => setSelectedColor(e.target.value)}
            className="border border-[#0F1E3C]/15 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            title="Foto específica de uma cor, ou deixe em branco pra valer pra todas"
          >
            <option value="">Todas as cores</option>
            {colors.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
          disabled={uploading}
          className="text-xs text-[#0F1E3C]/70 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#0F1E3C]/8 file:text-[#0F1E3C] file:text-xs file:cursor-pointer"
        />
        {uploading && <Loader2 size={14} className="animate-spin text-[#0F1E3C]/40" />}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {loading ? (
        <p className="text-xs text-[#0F1E3C]/40">Carregando fotos...</p>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-6 border border-dashed border-[#0F1E3C]/15 rounded-xl text-[#0F1E3C]/25">
          <ImageIcon size={22} />
          <p className="text-xs">Nenhuma foto ainda</p>
        </div>
      ) : (
        [...groups.entries()].map(([color, imgs]) => (
          <div key={color}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#0F1E3C]/40 mb-2">{color}</p>
            <div className="flex flex-wrap gap-3">
              {imgs.map((img) => (
                <div key={img.id} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#0F1E3C]/10 group">
                  <img src={img.imageUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleDelete(img.id)}
                    title="Remover foto"
                    className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/50 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={16} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
