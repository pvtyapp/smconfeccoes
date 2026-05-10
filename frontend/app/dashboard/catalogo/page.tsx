"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { Upload, Trash2, ImagePlus, Loader2, AlertCircle } from "lucide-react"
import type { CatalogProduct } from "@/components/landing/CatalogCarousel"

export default function CatalogoPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [name, setName] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState("")
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  async function fetchProducts() {
    try {
      const res = await fetch("/api/catalog")
      if (res.ok) setProducts(await res.json())
    } catch { /* silencioso */ }
  }

  useEffect(() => { fetchProducts() }, [])

  function handleFile(f: File) {
    if (!f.type.startsWith("image/")) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function handleAdd() {
    if (!name.trim() || !file) return
    setLoading(true)
    setError("")
    try {
      const form = new FormData()
      form.append("name", name.trim())
      form.append("file", file)
      const res = await fetch("/api/catalog", { method: "POST", body: form })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Erro ao enviar")
      }
      const product = await res.json()
      setProducts((p) => [...p, product])
      setName("")
      setFile(null)
      setPreview("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar produto")
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      await fetch(`/api/catalog/${id}`, { method: "DELETE" })
      setProducts((p) => p.filter((x) => x.id !== id))
    } finally {
      setDeleting(null)
    }
  }

  const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
          Produtos na Landing Page
        </h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">
          Produtos aqui aparecem no carrossel público da LP. Imagens salvas no Vercel Blob.
        </p>
      </div>

      {/* Form */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6">
        <h2 className="text-sm font-bold text-[#0F1E3C] mb-5">Adicionar produto</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Upload */}
          <div>
            <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">
              Foto do produto <span className="normal-case text-[#0F1E3C]/30">(proporção 1:1 recomendada)</span>
            </label>
            <div
              className={`relative border-2 border-dashed rounded-2xl aspect-square flex flex-col items-center justify-center cursor-pointer transition-all ${
                dragging
                  ? "border-[#4361EE] bg-[#4361EE]/5"
                  : "border-[#0F1E3C]/15 hover:border-[#4361EE]/40 bg-[#F4F6FB]"
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              {preview ? (
                <Image src={preview} alt="preview" fill className="object-cover rounded-2xl" />
              ) : (
                <div className="flex flex-col items-center gap-3 text-[#0F1E3C]/30 p-6 text-center">
                  <ImagePlus size={36} />
                  <div>
                    <p className="text-sm font-semibold">Clique ou arraste a foto</p>
                    <p className="text-xs mt-0.5">JPG, PNG, WEBP</p>
                  </div>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>

          {/* Name + action */}
          <div className="flex flex-col h-full gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2">
                Nome do produto
              </label>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Camiseta Básica Preta"
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }}
                disabled={loading}
              />
              <p className="text-xs text-[#0F1E3C]/35 mt-1.5">
                Aparecerá como legenda no carrossel da landing page.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-100 px-3 py-2.5 rounded-xl">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={handleAdd}
              disabled={!name.trim() || !file || loading}
              className="mt-auto flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-bold py-3 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" />Enviando...</>
              ) : (
                <><Upload size={16} />Adicionar ao catálogo</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div>
        <h2 className="text-sm font-bold text-[#0F1E3C] mb-4">
          Produtos no catálogo{" "}
          <span className="text-[#0F1E3C]/35 font-normal">({products.length})</span>
        </h2>

        {products.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-[#0F1E3C]/10 py-16 text-center text-[#0F1E3C]/25">
            <ImagePlus size={36} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum produto no catálogo ainda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {products.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden group shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="relative aspect-square bg-[#F4F6FB]">
                  <Image
                    src={p.image_url}
                    alt={p.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 50vw, 25vw"
                  />
                  <button
                    onClick={() => handleDelete(p.id)}
                    disabled={deleting === p.id}
                    className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 disabled:opacity-60"
                  >
                    {deleting === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
                <div className="p-3">
                  <p className="text-xs font-bold text-[#0F1E3C] truncate">{p.name}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
