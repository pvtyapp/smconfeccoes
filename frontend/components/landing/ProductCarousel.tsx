import Link from "next/link"
import { ImageIcon, ChevronRight } from "lucide-react"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"

// Prévia horizontal do catálogo — decisão do replano v2: não é a loja completa
// aqui (sem add-to-cart), é só chamariz. Clicar em qualquer parte de qualquer
// card, ou no CTA abaixo, leva pro /catalogo de verdade.
export default function ProductCarousel({ products }: { products: PublicCatalogProduct[] }) {
  if (products.length === 0) return null

  return (
    <section className="py-12 sm:py-16 px-5 bg-[#F4F6FB]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <p className="text-[#4361EE] text-sm font-semibold uppercase tracking-[0.15em] mb-2">Vitrine</p>
          <h2 className="text-2xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-2" style={{ fontFamily: "var(--font-playfair)" }}>
            O que tem pra pedir agora
          </h2>
          <p className="text-[#0F1E3C]/45 text-base sm:text-lg max-w-md mx-auto">
            Uma prévia — o catálogo completo tem muito mais
          </p>
        </div>

        <Link
          href="/catalogo"
          className="group block -mx-5 px-5 sm:mx-0 sm:px-0"
          aria-label="Ver catálogo completo"
        >
          <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory" style={{ scrollbarWidth: "none" }}>
            {products.slice(0, 10).map((p) => {
              const img = p.images[0]?.url ?? null
              return (
                <div
                  key={p.id}
                  className="flex-shrink-0 w-40 sm:w-48 snap-start rounded-2xl overflow-hidden bg-white border border-[#0F1E3C]/8 transition-transform duration-200 group-hover:[&:not(:hover)]:scale-[0.98] hover:!scale-[1.03] hover:shadow-lg hover:shadow-[#0F1E3C]/10"
                >
                  <div className="w-full aspect-square bg-[#F4F6FB] flex items-center justify-center overflow-hidden">
                    {img ? (
                      <img src={img} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={26} className="text-[#0F1E3C]/15" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-xs font-bold text-[#0F1E3C] truncate">{p.name}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </Link>

        <div className="flex justify-center mt-8">
          <Link
            href="/catalogo"
            className="inline-flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-base px-7 py-4 rounded-xl transition-all hover:scale-[1.02]"
          >
            Ir para o Catálogo
            <ChevronRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  )
}
