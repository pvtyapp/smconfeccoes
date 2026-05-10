"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { Upload, Trash2, ImagePlus, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
    } catch {
      // API indisponível
    }
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
      if (!res.ok) throw new Error(await res.text())

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

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Catálogo da Landing Page</h1>
        <p className="text-sm text-gray-500 mt-1">
          Produtos adicionados aqui aparecem no carrossel público. Imagens salvas no Vercel Blob.
        </p>
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h2 className="font-semibold text-gray-700">Adicionar produto</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Upload */}
          <div>
            <Label className="mb-2 block text-sm">Foto do produto</Label>
            <div
              className={`relative border-2 border-dashed rounded-xl aspect-square flex flex-col items-center justify-center cursor-pointer transition-colors ${
                dragging
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-400 bg-gray-50"
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              {preview ? (
                <Image src={preview} alt="preview" fill className="object-cover rounded-xl" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-400 p-4 text-center">
                  <ImagePlus size={32} />
                  <span className="text-sm font-medium">Clique ou arraste a foto</span>
                  <span className="text-xs">JPG, PNG, WEBP</span>
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
              <Label htmlFor="pname" className="mb-2 block text-sm">Nome do produto</Label>
              <Input
                id="pname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Camiseta Básica Preta"
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }}
                disabled={loading}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Aparecerá como legenda no carrossel da landing page.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
                <AlertCircle size={15} />
                {error}
              </div>
            )}

            <Button
              onClick={handleAdd}
              disabled={!name.trim() || !file || loading}
              className="mt-auto gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Adicionar ao catálogo
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* List */}
      <div>
        <h2 className="font-semibold text-gray-700 mb-4">
          Produtos no catálogo{" "}
          <span className="text-gray-400 font-normal">({products.length})</span>
        </h2>

        {products.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 py-14 text-center text-gray-400">
            <ImagePlus size={36} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum produto no catálogo ainda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {products.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden group shadow-sm"
              >
                <div className="relative aspect-square bg-gray-50">
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
                    className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 disabled:opacity-70"
                  >
                    {deleting === p.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                  </button>
                </div>
                <div className="p-3">
                  <p className="text-xs font-semibold text-gray-700 truncate">{p.name}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
