"use client"

import { MessageCircle } from "lucide-react"

export default function WhatsAppButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-[#25D366] text-white font-semibold text-sm px-5 py-3.5 rounded-full shadow-xl shadow-[#25D366]/40 hover:bg-[#20bd5a] hover:scale-105 transition-all"
      aria-label="Falar no WhatsApp"
    >
      <MessageCircle size={20} />
      <span className="hidden sm:inline">Falar no WhatsApp</span>
    </a>
  )
}
