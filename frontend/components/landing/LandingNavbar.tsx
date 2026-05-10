"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { MessageCircle, Menu, X } from "lucide-react"

const links = [
  { href: "#coleta", label: "Pontos de Coleta" },
  { href: "#servicos", label: "Serviços" },
  { href: "#catalogo", label: "Catálogo" },
  { href: "#localizacao", label: "Localização" },
]

export default function LandingNavbar({ waLink }: { waLink: string }) {
  const [open, setOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-50">

      {/* Announcement bar */}
      <div className="bg-[#0F1E3C] text-white text-xs py-2 px-5 text-center">
        <span className="text-white/50 mr-1.5">Em breve:</span>
        <span className="font-semibold text-white/90">Ponto de Coleta</span>
        <span className="mx-2 text-white/25">·</span>
        <span className="font-black text-[#F95B2B]">Shopee</span>
        <span className="mx-2 text-white/25">&amp;</span>
        <span className="font-black text-white">TikTok Shop</span>
        <span className="ml-2 text-white/40">— Franca/SP</span>
      </div>

      {/* Main nav + mobile menu */}
      <div className="bg-white/96 backdrop-blur-md border-b border-[#0F1E3C]/8">
        <div className="max-w-6xl mx-auto px-5 h-[64px] flex items-center justify-between">

          {/* Left */}
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/smsemfundo.png"
              alt="SM Confecções"
              width={52}
              height={26}
              className="object-contain"
            />
            <span
              className="text-[#0F1E3C] font-semibold text-base tracking-tight hidden sm:block"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              SM Confecções
            </span>
          </Link>

          {/* Center */}
          <nav className="hidden md:flex items-center gap-7">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm font-medium text-[#0F1E3C]/55 hover:text-[#0F1E3C] transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-3">
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 bg-[#25D366] text-white text-sm font-semibold px-4 py-2 rounded-full hover:bg-[#1ebe5d] transition-colors"
            >
              <MessageCircle size={15} />
              WhatsApp
            </a>
            <button
              onClick={() => setOpen((v) => !v)}
              className="md:hidden w-10 h-10 flex items-center justify-center rounded-xl text-[#0F1E3C] hover:bg-gray-100 transition-colors"
              aria-label="Menu"
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {open && (
          <div className="md:hidden border-t border-gray-100 px-5 py-4 space-y-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block py-2.5 text-sm font-medium text-[#0F1E3C]/70 hover:text-[#0F1E3C] transition-colors"
              >
                {l.label}
              </a>
            ))}
            <div className="pt-3 border-t border-gray-100 mt-2">
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-[#25D366] text-white text-sm font-semibold px-4 py-3 rounded-xl hover:bg-[#1ebe5d] transition-colors"
              >
                <MessageCircle size={16} />
                Falar no WhatsApp
              </a>
            </div>
          </div>
        )}
      </div>

    </header>
  )
}
