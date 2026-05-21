"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { ChevronLeft, ChevronRight, MessageCircle, Package, X } from "lucide-react"

export interface CatalogImage {
  id: string
  image_url: string
  display_order: number
  color?: string | null
}

export interface CatalogProduct {
  id: string
  name: string
  image_url: string
  display_order: number
  description?: string | null
  cover_color?: string | null
  images?: CatalogImage[]
}

interface Props {
  initialProducts: CatalogProduct[]
  waLink: string
}

function ProductModal({ product, onClose }: { product: CatalogProduct; onClose: () => void }) {
  const allPhotos: CatalogImage[] = [
    { id: "cover", image_url: product.image_url, display_order: -1, color: product.cover_color },
    ...(product.images ?? []),
  ]

  const [idx, setIdx] = useState(0)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1))
      if (e.key === "ArrowRight") setIdx((i) => Math.min(allPhotos.length - 1, i + 1))
    }
    window.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = "" }
  }, [onClose, allPhotos.length])

  // Color variations — only photos that have a color label
  const colorVariations = allPhotos.filter((p) => p.color?.trim())

  const waText = encodeURIComponent(`Olá! Tenho interesse no produto: ${product.name}`)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Photo */}
        <div className="relative aspect-square bg-[#0F1E3C]/5 rounded-t-2xl overflow-hidden">
          <Image
            src={allPhotos[idx].image_url}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 512px"
            priority
          />

          {allPhotos.length > 1 && (
            <>
              <button
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                disabled={idx === 0}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/85 backdrop-blur-sm rounded-full flex items-center justify-center shadow-md disabled:opacity-25 hover:bg-white transition-all"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setIdx((i) => Math.min(allPhotos.length - 1, i + 1))}
                disabled={idx === allPhotos.length - 1}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-white/85 backdrop-blur-sm rounded-full flex items-center justify-center shadow-md disabled:opacity-25 hover:bg-white transition-all"
              >
                <ChevronRight size={18} />
              </button>

              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {allPhotos.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setIdx(i)}
                    className={`rounded-full transition-all ${i === idx ? "w-5 h-2 bg-white" : "w-2 h-2 bg-white/50 hover:bg-white/75"}`}
                  />
                ))}
              </div>
            </>
          )}

          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 bg-black/40 hover:bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center text-white transition-colors"
          >
            <X size={16} />
          </button>

          {allPhotos.length > 1 && (
            <div className="absolute top-3 left-3 bg-black/40 backdrop-blur-sm text-white text-xs font-semibold px-2 py-1 rounded-full">
              {idx + 1}/{allPhotos.length}
            </div>
          )}
        </div>

        {/* Thumbs */}
        {allPhotos.length > 1 && (
          <div className="flex gap-2 px-4 pt-3 overflow-x-auto pb-1">
            {allPhotos.map((photo, i) => (
              <button
                key={photo.id}
                onClick={() => setIdx(i)}
                className={`relative flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 transition-all ${i === idx ? "border-[#4361EE]" : "border-transparent opacity-55 hover:opacity-100"}`}
              >
                <Image src={photo.image_url} alt="" fill className="object-cover" sizes="56px" />
              </button>
            ))}
          </div>
        )}

        {/* Info */}
        <div className="px-5 pt-4 pb-5 space-y-3">
          <h3 className="text-lg font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            {product.name}
          </h3>

          {/* Color variations */}
          {colorVariations.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wider mb-2">Cores disponíveis</p>
              <div className="flex flex-wrap gap-2">
                {colorVariations.map((photo) => {
                  const photoIdx = allPhotos.findIndex((p) => p.id === photo.id)
                  const active = idx === photoIdx
                  return (
                    <button
                      key={photo.id}
                      onClick={() => setIdx(photoIdx)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                        active
                          ? "bg-[#0F1E3C] text-white border-[#0F1E3C]"
                          : "bg-white text-[#0F1E3C]/70 border-[#0F1E3C]/20 hover:border-[#0F1E3C]/50"
                      }`}
                    >
                      {photo.color}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Description — preserva quebras de linha */}
          {product.description && (
            <p className="text-sm text-[#0F1E3C]/60 leading-relaxed whitespace-pre-wrap">
              {product.description}
            </p>
          )}

          <a
            href={`https://wa.me/5516992692363?text=${waText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5d] text-white font-bold py-3 rounded-xl transition-colors text-sm"
          >
            <MessageCircle size={17} />
            Tenho interesse — falar no WhatsApp
          </a>
        </div>
      </div>
    </div>
  )
}

export default function CatalogCarousel({ initialProducts, waLink }: Props) {
  const [products] = useState<CatalogProduct[]>(initialProducts)
  const [index, setIndex] = useState(0)
  const [cols, setCols] = useState(3)
  const [selected, setSelected] = useState<CatalogProduct | null>(null)

  useEffect(() => {
    const update = () => {
      if (window.innerWidth < 640) setCols(1)
      else if (window.innerWidth < 1024) setCols(2)
      else setCols(3)
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  const maxIndex = Math.max(0, products.length - cols)
  const prev = () => setIndex((i) => Math.max(0, i - 1))
  const next = () => setIndex((i) => Math.min(maxIndex, i + 1))
  const cardWidth = `calc(${100 / cols}% - ${(20 * (cols - 1)) / cols}px)`

  return (
    <>
      <section id="catalogo" className="py-20 sm:py-28 px-5 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-4"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              Nossos Produtos
            </h2>
            <p className="text-[#0F1E3C]/45 text-base sm:text-lg max-w-sm mx-auto leading-relaxed">
              Peças de qualidade, produção própria. Clique para ver detalhes.
            </p>
          </div>

          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 border-2 border-dashed border-[#0F1E3C]/8 rounded-2xl text-[#0F1E3C]/25">
              <Package size={44} />
              <p className="text-sm font-semibold">Catálogo em breve</p>
            </div>
          ) : (
            <div className="relative px-1">
              <div className="overflow-hidden">
                <div
                  className="flex gap-5 transition-transform duration-500 ease-in-out"
                  style={{ transform: `translateX(calc(-${index} * (${cardWidth} + 20px)))` }}
                >
                  {products.map((p) => (
                    <div
                      key={p.id}
                      className="flex-shrink-0 bg-[#F4F6FB] rounded-2xl overflow-hidden border border-[#0F1E3C]/5 group hover:shadow-md transition-shadow cursor-pointer"
                      style={{ width: cardWidth }}
                      onClick={() => setSelected(p)}
                    >
                      <div className="relative aspect-square overflow-hidden">
                        <Image
                          src={p.image_url}
                          alt={p.name}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-500"
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        />
                        {(p.images?.length ?? 0) > 0 && (
                          <div className="absolute bottom-2 right-2 bg-black/50 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                            {(p.images?.length ?? 0) + 1} fotos
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <p className="font-bold text-[#0F1E3C] text-sm truncate">{p.name}</p>
                        {p.description ? (
                          <p className="text-xs text-[#0F1E3C]/45 mt-1 line-clamp-2 leading-relaxed">{p.description}</p>
                        ) : (
                          <p className="text-xs text-[#4361EE] mt-1 font-semibold">Ver detalhes →</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {maxIndex > 0 && (
                <>
                  <button onClick={prev} disabled={index === 0} className="absolute -left-4 top-[calc(50%-2rem)] w-10 h-10 bg-white border border-[#0F1E3C]/10 rounded-full shadow-md flex items-center justify-center text-[#0F1E3C] hover:bg-[#F4F6FB] disabled:opacity-25 disabled:cursor-not-allowed transition-all">
                    <ChevronLeft size={18} />
                  </button>
                  <button onClick={next} disabled={index >= maxIndex} className="absolute -right-4 top-[calc(50%-2rem)] w-10 h-10 bg-white border border-[#0F1E3C]/10 rounded-full shadow-md flex items-center justify-center text-[#0F1E3C] hover:bg-[#F4F6FB] disabled:opacity-25 disabled:cursor-not-allowed transition-all">
                    <ChevronRight size={18} />
                  </button>
                </>
              )}

              {maxIndex > 0 && (
                <div className="flex justify-center gap-2 mt-8">
                  {Array.from({ length: maxIndex + 1 }).map((_, i) => (
                    <button key={i} onClick={() => setIndex(i)}
                      className={`rounded-full transition-all ${i === index ? "w-6 h-2 bg-[#4361EE]" : "w-2 h-2 bg-[#0F1E3C]/15 hover:bg-[#0F1E3C]/30"}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-center mt-12">
            <a href={waLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold px-7 py-3.5 rounded-xl transition-colors">
              <MessageCircle size={17} />
              Ver catálogo completo no WhatsApp
            </a>
          </div>
        </div>
      </section>

      {selected && <ProductModal product={selected} onClose={() => setSelected(null)} />}
    </>
  )
}
