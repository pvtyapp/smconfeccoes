"use client"

import { useEffect, useState, useCallback } from "react"
import Image from "next/image"
import { ChevronLeft, ChevronRight } from "lucide-react"

export interface HeroBanner {
  id: number
  image_url: string
}

const AUTOPLAY_MS = 5000

export default function HeroBannerCarousel({ banners }: { banners: HeroBanner[] }) {
  const [index, setIndex] = useState(0)

  const next = useCallback(() => setIndex((i) => (i + 1) % banners.length), [banners.length])
  const prev = useCallback(() => setIndex((i) => (i - 1 + banners.length) % banners.length), [banners.length])

  useEffect(() => {
    if (banners.length < 2) return
    const t = setInterval(next, AUTOPLAY_MS)
    return () => clearInterval(t)
  }, [next, banners.length])

  if (banners.length === 0) return null

  return (
    <section className="relative w-full aspect-[2.5/1] bg-[#0A1628] overflow-hidden">
      {banners.map((b, i) => (
        <div
          key={b.id}
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: i === index ? 1 : 0, pointerEvents: i === index ? "auto" : "none" }}
        >
          <Image
            src={b.image_url}
            alt=""
            fill
            className="object-cover"
            priority={i === 0}
            sizes="100vw"
          />
        </div>
      ))}

      {banners.length > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="Anterior"
            className="absolute left-1.5 sm:left-3 top-1/2 -translate-y-1/2 w-6 h-6 sm:w-10 sm:h-10 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white rounded-full flex items-center justify-center transition-colors"
          >
            <ChevronLeft size={14} className="sm:hidden" />
            <ChevronLeft size={20} className="hidden sm:block" />
          </button>
          <button
            onClick={next}
            aria-label="Próximo"
            className="absolute right-1.5 sm:right-3 top-1/2 -translate-y-1/2 w-6 h-6 sm:w-10 sm:h-10 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white rounded-full flex items-center justify-center transition-colors"
          >
            <ChevronRight size={14} className="sm:hidden" />
            <ChevronRight size={20} className="hidden sm:block" />
          </button>

          <div className="absolute bottom-1.5 sm:bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 sm:gap-2">
            {banners.map((b, i) => (
              <button
                key={b.id}
                onClick={() => setIndex(i)}
                aria-label={`Ir pro banner ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-6 bg-white" : "w-1.5 bg-white/40 hover:bg-white/60"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
