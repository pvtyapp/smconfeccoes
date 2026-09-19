"use client"

import { useEffect, useState } from "react"
import { ShoppingCart, Package } from "lucide-react"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"
import ProductCard from "./ProductCard"
import CartDrawer from "./CartDrawer"
import { type CartItem, loadCart, saveCart } from "./cart"

export default function CatalogClient({ products }: { products: PublicCatalogProduct[] }) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => { setCart(loadCart()); setHydrated(true) }, [])
  useEffect(() => { if (hydrated) saveCart(cart) }, [cart, hydrated])

  function handleAdd(item: CartItem) {
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === item.variantId)
      if (existing) return prev.map((i) => (i.variantId === item.variantId ? { ...i, qty: i.qty + 1 } : i))
      return [...prev, item]
    })
    setShowCart(true)
  }

  function handleRemove(variantId: string) {
    setCart((prev) => prev.filter((i) => i.variantId !== variantId))
  }

  function handleChangeQty(variantId: string, qty: number) {
    setCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, qty } : i)))
  }

  const cartCount = cart.reduce((s, i) => s + i.qty, 0)

  return (
    <>
      <button
        type="button" onClick={() => setShowCart(true)}
        aria-label={`Abrir carrinho${cartCount > 0 ? ` — ${cartCount} ite${cartCount === 1 ? "m" : "ns"}` : ""}`}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white shadow-lg flex items-center justify-center transition-colors"
      >
        <ShoppingCart size={20} />
        {cartCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-[#4361EE] text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {cartCount}
          </span>
        )}
      </button>

      {products.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 border border-dashed border-[#0F1E3C]/15 rounded-2xl text-[#0F1E3C]/30">
          <Package size={28} />
          <p className="text-sm">Nenhum produto disponível no momento.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p) => <ProductCard key={p.id} product={p} onAdd={handleAdd} />)}
        </div>
      )}

      {showCart && (
        <CartDrawer
          items={cart}
          onClose={() => setShowCart(false)}
          onRemove={handleRemove}
          onChangeQty={handleChangeQty}
          onCleared={() => setCart([])}
        />
      )}
    </>
  )
}
