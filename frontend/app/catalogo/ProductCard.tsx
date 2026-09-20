"use client"

import { useMemo, useState } from "react"
import { ImageIcon, ShoppingCart, Check } from "lucide-react"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"
import type { CartItem } from "./cart"

function fmtR(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ProductCard({ product, onAdd }: { product: PublicCatalogProduct; onAdd: (item: CartItem) => void }) {
  const colors = useMemo(() => [...new Set(product.variants.map((v) => v.color).filter(Boolean))] as string[], [product])
  const [color, setColor] = useState<string | null>(colors[0] ?? null)
  const sizesForColor = product.variants.filter((v) => v.color === color)
  const [size, setSize] = useState<string | null>(sizesForColor[0]?.size ?? null)

  const image = useMemo(() => {
    const specific = product.images.find((i) => i.color === color)
    const general = product.images.find((i) => i.color === null)
    return specific ?? general ?? null
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
    if (!selectedVariant || !available) return
    onAdd({
      variantId: selectedVariant.id, productId: product.id, productName: product.name,
      color: selectedVariant.color, size: selectedVariant.size, price: selectedVariant.price, qty: 1,
    })
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  return (
    <div className="flex items-center gap-3 sm:gap-4 bg-white border border-[#0F1E3C]/8 rounded-2xl p-3 sm:p-4">
      <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 rounded-xl overflow-hidden bg-[#F4F6FB] flex items-center justify-center">
        {image ? (
          <img src={image.url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon size={22} className="text-[#0F1E3C]/15" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-[#0F1E3C] truncate">{product.name}</p>
          <span className="text-sm font-black text-[#4361EE] flex-shrink-0">{fmtR(selectedVariant?.price ?? product.salePrice)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          {colors.length > 0 && (
            <select
              value={color ?? ""} onChange={(e) => changeColor(e.target.value)}
              aria-label={`Cor de ${product.name}`}
              className="text-xs font-semibold border border-[#0F1E3C]/12 rounded-lg px-2.5 py-1.5 text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            >
              {colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {sizesForColor.length > 0 && (
            <select
              value={size ?? ""} onChange={(e) => setSize(e.target.value)}
              aria-label={`Tamanho de ${product.name}`}
              className="text-xs font-semibold border border-[#0F1E3C]/12 rounded-lg px-2.5 py-1.5 text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            >
              {sizesForColor.map((v) => <option key={v.id} value={v.size ?? ""}>{v.size ?? "Único"}</option>)}
            </select>
          )}
          <span className={`text-[11px] font-bold ${available ? "text-[#1B8F63]" : "text-[#B23B3B]"}`}>
            {available ? "Disponível" : "Indisponível"}
          </span>
        </div>
      </div>

      <button
        type="button" onClick={handleAdd} disabled={!available}
        aria-label={`Adicionar ${product.name} ao carrinho`}
        className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#0F1E3C] hover:bg-[#1B2A4A] disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
      >
        {added ? <Check size={16} /> : <ShoppingCart size={16} />}
      </button>
    </div>
  )
}
