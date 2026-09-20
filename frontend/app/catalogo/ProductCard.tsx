"use client"

import { useMemo, useState } from "react"
import { ImageIcon, ShoppingCart, Check, Minus, Plus, Images as ImagesIcon, Ruler } from "lucide-react"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"
import type { CartItem } from "./cart"
import { colorToHex, needsBorder } from "./colorSwatch"
import Lightbox from "./Lightbox"

function fmtR(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ProductCard({ product, onAdd }: { product: PublicCatalogProduct; onAdd: (item: CartItem) => void }) {
  const colors = useMemo(() => [...new Set(product.variants.map((v) => v.color).filter(Boolean))] as string[], [product])
  const [color, setColor] = useState<string | null>(colors[0] ?? null)
  const sizesForColor = product.variants.filter((v) => v.color === color)
  const [size, setSize] = useState<string | null>(sizesForColor[0]?.size ?? null)
  const [qty, setQty] = useState(1)
  const [lightbox, setLightbox] = useState<{ open: boolean; startIndex: number }>({ open: false, startIndex: 0 })

  const thumb = useMemo(() => {
    const specific = product.images.find((i) => i.color === color)
    const general = product.images.find((i) => i.color === null)
    return specific ?? general ?? null
  }, [product.images, color])

  const galleryImages = useMemo(() => {
    const byColor = product.images.filter((i) => i.color === color)
    if (byColor.length > 0) return byColor
    const general = product.images.filter((i) => i.color === null)
    if (general.length > 0) return general
    return product.images
  }, [product.images, color])

  function changeColor(c: string) {
    setColor(c)
    const first = product.variants.find((v) => v.color === c)
    setSize(first?.size ?? null)
  }

  const selectedVariant = product.variants.find((v) => v.color === color && v.size === size)
  const available = selectedVariant?.available ?? false
  const [added, setAdded] = useState(false)

  function handleAdd() {
    if (!selectedVariant || !available || qty < 1) return
    onAdd({
      variantId: selectedVariant.id, productId: product.id, productName: product.name,
      color: selectedVariant.color, size: selectedVariant.size, price: selectedVariant.price, qty,
    })
    setAdded(true)
    setQty(1)
    setTimeout(() => setAdded(false), 1500)
  }

  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 bg-white border border-[#0F1E3C]/8 rounded-2xl p-3 sm:p-4">
      <button
        type="button"
        onClick={() => galleryImages.length > 0 && setLightbox({ open: true, startIndex: 0 })}
        aria-label={galleryImages.length > 0 ? `Ver fotos de ${product.name}` : product.name}
        className="relative w-full h-40 sm:w-20 sm:h-20 flex-shrink-0 rounded-xl overflow-hidden bg-[#F4F6FB] flex items-center justify-center"
      >
        {thumb ? (
          <img src={thumb.url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon size={22} className="text-[#0F1E3C]/15" />
        )}
        {galleryImages.length > 1 && (
          <span className="absolute bottom-1 right-1 flex items-center gap-0.5 bg-black/55 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
            <ImagesIcon size={9} /> {galleryImages.length}
          </span>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <p className="text-sm font-bold text-[#0F1E3C]">{product.name}</p>
            {galleryImages.length > 0 && (
              <button
                type="button"
                onClick={() => setLightbox({ open: true, startIndex: galleryImages.length - 1 })}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-[#4361EE] bg-[#4361EE]/8 hover:bg-[#4361EE]/14 px-2 py-1 rounded-lg transition-colors flex-shrink-0"
              >
                <Ruler size={11} /> Ver tabela de medidas
              </button>
            )}
          </div>
          <span className="text-sm font-black text-[#4361EE] flex-shrink-0">{fmtR(selectedVariant?.price ?? product.salePrice)}</span>
        </div>

        {colors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            {colors.map((c) => {
              const hex = colorToHex(c)
              const active = c === color
              return (
                <button
                  key={c} type="button" onClick={() => changeColor(c)}
                  aria-label={`Cor ${c}`} aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                    active ? "bg-[#0F1E3C] text-white" : "bg-[#F4F6FB] text-[#0F1E3C]/70 hover:bg-[#0F1E3C]/8"
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: hex, border: needsBorder(hex) || active ? "1px solid rgba(255,255,255,.6)" : "1px solid rgba(15,30,60,.15)" }}
                  />
                  {c}
                </button>
              )
            })}
          </div>
        )}

        {sizesForColor.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {sizesForColor.map((v) => {
              const active = v.size === size
              return (
                <button
                  key={v.id} type="button" onClick={() => setSize(v.size)}
                  aria-label={`Tamanho ${v.size ?? "Único"}`} aria-pressed={active}
                  className={`min-w-[34px] text-center px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    active ? "bg-[#4361EE] text-white" : "bg-[#F4F6FB] text-[#0F1E3C]/70 hover:bg-[#0F1E3C]/8"
                  }`}
                >
                  {v.size ?? "Único"}
                </button>
              )
            })}
          </div>
        )}

        <span className={`inline-block text-[11px] font-bold mt-2 ${available ? "text-[#1B8F63]" : "text-[#B23B3B]"}`}>
          {available ? "Disponível" : "Indisponível"}
        </span>
      </div>

      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-1 bg-[#F4F6FB] rounded-xl px-1 py-1">
          <button
            type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Diminuir quantidade"
            className="w-7 h-7 flex items-center justify-center text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
          >
            <Minus size={13} />
          </button>
          <input
            type="number" min={1} inputMode="numeric" value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            aria-label="Quantidade"
            className="w-10 text-center text-sm font-bold text-[#0F1E3C] bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            type="button" onClick={() => setQty((q) => q + 1)} aria-label="Aumentar quantidade"
            className="w-7 h-7 flex items-center justify-center text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
          >
            <Plus size={13} />
          </button>
        </div>

        <button
          type="button" onClick={handleAdd} disabled={!available}
          aria-label={`Adicionar ${qty}x ${product.name} ao carrinho`}
          className="flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 sm:w-full rounded-xl bg-[#0F1E3C] hover:bg-[#1B2A4A] disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
        >
          {added ? <Check size={15} /> : <ShoppingCart size={15} />}
          {added ? "Adicionado" : "Adicionar"}
        </button>
      </div>

      {lightbox.open && (
        <Lightbox
          images={galleryImages} productName={product.name} initialIndex={lightbox.startIndex}
          onClose={() => setLightbox({ open: false, startIndex: 0 })}
        />
      )}
    </div>
  )
}
