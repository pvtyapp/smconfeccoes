import Image from "next/image"
import Link from "next/link"
import { MessageCircle } from "lucide-react"

const links = [
  { href: "#servicos", label: "Serviços" },
  { href: "#catalogo", label: "Catálogo" },
  { href: "#localizacao", label: "Localização" },
]

export default function LandingNavbar({ waLink }: { waLink: string }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#0F1E3C] md:bg-transparent">
      <div className="max-w-6xl mx-auto px-5 h-12 md:h-16 flex items-center justify-between">

        {/* Left — só o logo, invertido pra branco e com sombra pra destacar em foto escura no PC */}
        <Link href="/" className="flex items-center flex-shrink-0">
          <Image
            src="/smsemfundo.png"
            alt="SM Confecções"
            width={52}
            height={26}
            className="object-contain brightness-0 invert md:drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)] w-9 md:w-[52px] h-auto"
          />
        </Link>

        {/* Center — sempre visível, no mobile numa barra sólida, no PC sobreposto e transparente */}
        <nav className="flex items-center gap-3 md:gap-5 lg:gap-8 xl:gap-10">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-xs md:text-sm font-semibold text-white md:drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] hover:text-white/80 transition-colors whitespace-nowrap"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Right */}
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 md:gap-2 text-white text-xs md:text-sm font-semibold md:drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] hover:text-white/80 transition-colors flex-shrink-0"
        >
          <MessageCircle size={14} className="md:hidden" />
          <MessageCircle size={15} className="hidden md:block" />
          <span className="hidden sm:inline">WhatsApp</span>
        </a>
      </div>
    </header>
  )
}
