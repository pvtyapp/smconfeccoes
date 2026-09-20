"use client"

import { useEffect, useState } from "react"
import { Package } from "lucide-react"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"
import ProductCard from "./ProductCard"
import CartPanel from "./CartPanel"
import { type CartItem, loadCart, saveCart } from "./cart"

// Carrinho sempre visível, painel fixo à esquerda em telas largas (md+) —
// nunca escondido atrás de botão/drawer. Em telas estreitas empilha em
// cima da lista de produto, mas continua sempre expandido, nunca atrás
// de um toque extra.
export default function CatalogClient({ products }: { products: PublicCatalogProduct[] }) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => { setCart(loadCart()); setHydrated(true) }, [])
  useEffect(() => { if (hydrated) saveCart(cart) }, [cart, hydrated])

  function handleAdd(item: CartItem) {
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === item.variantId)
      if (existing) return prev.map((i) => (i.variantId === item.variantId ? { ...i, qty: i.qty + 1 } : i))
      return [...prev, item]
    })
  }

  function handleRemove(variantId: string) {
    setCart((prev) => prev.filter((i) => i.variantId !== variantId))
  }

  function handleChangeQty(variantId: string, qty: number) {
    setCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, qty } : i)))
  }

  return (
    <div className="flex flex-col md:flex-row gap-5 items-start">
      <div className="w-full md:w-80 flex-shrink-0 order-1">
        <CartPanel
          items={cart}
          onRemove={handleRemove}
          onChangeQty={handleChangeQty}
          onCleared={() => setCart([])}
        />
      </div>

      <div className="flex-1 min-w-0 order-2 w-full">
        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 border border-dashed border-[#0F1E3C]/15 rounded-2xl text-[#0F1E3C]/30">
            <Package size={28} />
            <p className="text-sm">Nenhum produto disponível no momento.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((p) => <ProductCard key={p.id} product={p} onAdd={handleAdd} />)}
          </div>
        )}
      </div>
    </div>
  )
}
