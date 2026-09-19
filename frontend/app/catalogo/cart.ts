export type CartItem = {
  variantId: string
  productId: string
  productName: string
  color: string | null
  size: string | null
  price: number
  qty: number
}

export const CART_STORAGE_KEY = "sm_cart"

export function loadCart(): CartItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveCart(items: CartItem[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // localStorage indisponível (aba privada etc.) — carrinho só não sobrevive a reload
  }
}
