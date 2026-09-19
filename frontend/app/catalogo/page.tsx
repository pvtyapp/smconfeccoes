export const dynamic = "force-dynamic"

import Image from "next/image"
import Link from "next/link"
import { Package, MessageCircle } from "lucide-react"
import { getPublicCatalog } from "@/lib/catalog/getPublicCatalog"
import ProductCard from "./ProductCard"

const WA_LINK = `https://wa.me/5516992692363?text=${encodeURIComponent(
  "Olá! Gostaria de mais informações sobre a SM Confecções."
)}`

export default async function CatalogoPage() {
  const products = await getPublicCatalog()

  return (
    <div className="min-h-screen bg-[#F4F6FB]" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
      <header className="bg-[#0F1E3C] px-5 sm:px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <Image src="/smsemfundo.png" alt="SM Confecções" width={110} height={55}
            className="w-[80px] h-auto brightness-0 invert" />
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/portal/login" className="text-xs sm:text-sm font-semibold text-white/75 hover:text-white transition-colors">
            Área do Cliente
          </Link>
          <a href={WA_LINK} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-lg transition-colors">
            <MessageCircle size={14} /> WhatsApp
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-4xl font-black text-[#0F1E3C] mb-2" style={{ fontFamily: "var(--font-playfair)" }}>
            Catálogo
          </h1>
          <p className="text-[#0F1E3C]/50 text-sm sm:text-base">
            Atacado sem pedido mínimo. Pra montar seu pedido, entre com sua conta ou crie uma agora.
          </p>
        </div>

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 border border-dashed border-[#0F1E3C]/15 rounded-2xl text-[#0F1E3C]/30">
            <Package size={28} />
            <p className="text-sm">Nenhum produto disponível no momento.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </main>
    </div>
  )
}
