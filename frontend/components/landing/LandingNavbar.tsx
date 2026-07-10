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

      {/* Main nav — transparente, sobreposto ao hero/carrossel */}
      <div>
        <div className="max-w-6xl mx-auto px-5 h-[64px] flex items-center justify-between">

          {/* Left — só o logo, invertido pra branco e com sombra pra destacar em foto escura */}
          <Link href="/" className="flex items-center">
            <Image
              src="/smsemfundo.png"
              alt="SM Confecções"
              width={52}
              height={26}
              className="object-contain brightness-0 invert drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
            />
          </Link>

          {/* Center */}
          <nav className="hidden md:flex items-center gap-2">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm font-semibold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] hover:text-white/80 transition-colors"
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
              className="hidden sm:flex items-center gap-2 text-white text-sm font-semibold drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] hover:text-white/80 transition-colors"
            >
              <MessageCircle size={15} />
              WhatsApp
            </a>
            <button
              onClick={() => setOpen((v) => !v)}
              className="md:hidden w-10 h-10 flex items-center justify-center text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] hover:text-white/80 transition-colors"
              aria-label="Menu"
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile menu — painel sólido, precisa ser legível independente da foto atrás */}
        {open && (
          <div className="md:hidden mx-5 mt-2 bg-white rounded-2xl shadow-xl px-5 py-4 space-y-1">
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
