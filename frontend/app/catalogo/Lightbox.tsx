"use client"

import { useEffect, useState } from "react"
import { X, ChevronLeft, ChevronRight } from "lucide-react"

export default function Lightbox({
  images, productName, onClose, initialIndex = 0,
}: {
  images: { url: string; color: string | null }[]
  productName: string
  onClose: () => void
  initialIndex?: number
}) {
  const [index, setIndex] = useState(initialIndex)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length)
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + images.length) % images.length)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [images.length, onClose])

  if (images.length === 0) return null
  const current = images[index]

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog" aria-modal="true" aria-label={`Fotos de ${productName}`}
    >
      <button
        onClick={onClose} aria-label="Fechar"
        className="absolute top-4 right-4 text-white/70 hover:text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
      >
        <X size={22} />
      </button>

      <div className="relative w-full max-w-lg flex items-center justify-center">
        {images.length > 1 && (
          <button
            onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
            aria-label="Foto anterior"
            className="absolute left-1 sm:-left-14 text-white/70 hover:text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors z-10"
          >
            <ChevronLeft size={26} />
          </button>
        )}

        <div className="w-full aspect-square rounded-2xl overflow-hidden bg-white/5">
          <img src={current.url} alt={`${productName}${current.color ? ` — ${current.color}` : ""}`} className="w-full h-full object-contain" />
        </div>

        {images.length > 1 && (
          <button
            onClick={() => setIndex((i) => (i + 1) % images.length)}
            aria-label="Próxima foto"
            className="absolute right-1 sm:-right-14 text-white/70 hover:text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors z-10"
          >
            <ChevronRight size={26} />
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          {images.map((img, i) => (
            <button
              key={img.url + i} onClick={() => setIndex(i)}
              aria-label={`Ver foto ${i + 1}`}
              className={`w-1.5 h-1.5 rounded-full transition-all ${i === index ? "bg-white w-4" : "bg-white/35"}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
