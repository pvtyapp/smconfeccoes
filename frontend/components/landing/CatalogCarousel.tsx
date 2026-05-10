"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { ChevronLeft, ChevronRight, MessageCircle, Package } from "lucide-react"

export interface CatalogProduct {
  id: string
  name: string
  image_url: string
  display_order: number
}

interface Props {
  initialProducts: CatalogProduct[]
  waLink: string
}

export default function CatalogCarousel({ initialProducts, waLink }: Props) {
  const [products] = useState<CatalogProduct[]>(initialProducts)
  const [index, setIndex] = useState(0)
  const [cols, setCols] = useState(3)

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
            Peças de qualidade, produção própria. Fale conosco para encomendar.
          </p>
        </div>

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 border-2 border-dashed border-[#0F1E3C]/8 rounded-2xl text-[#0F1E3C]/25">
            <Package size={44} />
            <p className="text-sm font-semibold">Catálogo em breve</p>
          </div>
        ) : (
          <div className="relative px-1">
            {/* Track */}
            <div className="overflow-hidden">
              <div
                className="flex gap-5 transition-transform duration-500 ease-in-out"
                style={{
                  transform: `translateX(calc(-${index} * (${cardWidth} + 20px)))`,
                }}
              >
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="flex-shrink-0 bg-[#F4F6FB] rounded-2xl overflow-hidden border border-[#0F1E3C]/5 group hover:shadow-md transition-shadow"
                    style={{ width: cardWidth }}
                  >
                    <div className="relative aspect-square overflow-hidden">
                      <Image
                        src={p.image_url}
                        alt={p.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      />
                    </div>
                    <div className="p-4">
                      <p className="font-bold text-[#0F1E3C] text-sm truncate">{p.name}</p>
                      <a
                        href={`https://wa.me/5516999999999?text=${encodeURIComponent(`Olá! Tenho interesse no produto: ${p.name}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2.5 flex items-center gap-1.5 text-xs font-bold text-[#25D366] hover:text-[#1ebe5d] transition-colors"
                      >
                        <MessageCircle size={12} />
                        Tenho interesse
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Arrows */}
            {maxIndex > 0 && (
              <>
                <button
                  onClick={prev}
                  disabled={index === 0}
                  className="absolute -left-4 top-[calc(50%-2rem)] w-10 h-10 bg-white border border-[#0F1E3C]/10 rounded-full shadow-md flex items-center justify-center text-[#0F1E3C] hover:bg-[#F4F6FB] disabled:opacity-25 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={next}
                  disabled={index >= maxIndex}
                  className="absolute -right-4 top-[calc(50%-2rem)] w-10 h-10 bg-white border border-[#0F1E3C]/10 rounded-full shadow-md flex items-center justify-center text-[#0F1E3C] hover:bg-[#F4F6FB] disabled:opacity-25 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRight size={18} />
                </button>
              </>
            )}

            {/* Dots */}
            {maxIndex > 0 && (
              <div className="flex justify-center gap-2 mt-8">
                {Array.from({ length: maxIndex + 1 }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setIndex(i)}
                    className={`rounded-full transition-all ${
                      i === index
                        ? "w-6 h-2 bg-[#4361EE]"
                        : "w-2 h-2 bg-[#0F1E3C]/15 hover:bg-[#0F1E3C]/30"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="text-center mt-12">
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold px-7 py-3.5 rounded-xl transition-colors"
          >
            <MessageCircle size={17} />
            Ver catálogo completo no WhatsApp
          </a>
        </div>
      </div>
    </section>
  )
}
