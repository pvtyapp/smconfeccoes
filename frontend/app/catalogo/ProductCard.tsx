"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"

function fmtR(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ProductCard({ product }: { product: PublicCatalogProduct }) {
  const colors = useMemo(() => [...new Set(product.variants.map((v) => v.color).filter(Boolean))] as string[], [product])
  const [color, setColor] = useState<string | null>(colors[0] ?? null)
  const sizesForColor = product.variants.filter((v) => v.color === color)
  const [size, setSize] = useState<string | null>(sizesForColor[0]?.size ?? null)
  const [imgIdx, setImgIdx] = useState(0)

  const images = useMemo(() => {
    const specific = product.images.filter((i) => i.color === color)
    const general = product.images.filter((i) => i.color === null)
    return specific.length > 0 ? specific : general
  }, [product.images, color])

  function changeColor(c: string) {
    setColor(c)
    const first = product.variants.find((v) => v.color === c)
    setSize(first?.size ?? null)
    setImgIdx(0)
  }

  const selectedVariant = product.variants.find((v) => v.color === color && v.size === size)
  const available = selectedVariant?.available ?? false

  return (
    <div className="bg-white border border-[#0F1E3C]/8 rounded-2xl overflow-hidden flex flex-col">
      <div className="relative w-full aspect-square bg-[#F4F6FB]">
        {images.length > 0 ? (
          <img src={images[imgIdx]?.url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#0F1E3C]/15">
            <ImageIcon size={36} />
          </div>
        )}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setImgIdx((i) => (i - 1 + images.length) % images.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/85 flex items-center justify-center text-[#0F1E3C] hover:bg-white"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => setImgIdx((i) => (i + 1) % images.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/85 flex items-center justify-center text-[#0F1E3C] hover:bg-white"
            >
              <ChevronRight size={15} />
            </button>
          </>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-sm font-bold text-[#0F1E3C]">{product.name}</p>
          <span className="text-sm font-black text-[#4361EE] flex-shrink-0">{fmtR(product.salePrice)}</span>
        </div>
        {product.description && <p className="text-xs text-[#0F1E3C]/45 mb-3 line-clamp-2">{product.description}</p>}

        {colors.length > 0 && (
          <div className="mb-2.5">
            <p className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wide mb-1.5">Cor</p>
            <div className="flex flex-wrap gap-1.5">
              {colors.map((c) => (
                <button
                  key={c} type="button" onClick={() => changeColor(c)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${color === c ? "border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]" : "border-[#0F1E3C]/12 text-[#0F1E3C]/60 hover:border-[#0F1E3C]/25"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {sizesForColor.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wide mb-1.5">Tamanho</p>
            <div className="flex flex-wrap gap-1.5">
              {sizesForColor.map((v) => (
                <button
                  key={v.id} type="button" onClick={() => setSize(v.size)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${size === v.size ? "border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]" : "border-[#0F1E3C]/12 text-[#0F1E3C]/60 hover:border-[#0F1E3C]/25"}`}
                >
                  {v.size ?? "Único"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-auto">
          <span className={`text-[11px] font-bold ${available ? "text-[#1B8F63]" : "text-[#B23B3B]"}`}>
            {available ? "Disponível" : "Indisponível"}
          </span>
        </div>
      </div>
    </div>
  )
}
