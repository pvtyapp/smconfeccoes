"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Package,
  Tags,
  Factory,
  Wallet,
  Boxes,
  Target,
  BarChart3,
  Users,
  Images,
} from "lucide-react"

const nav = [
  { href: "/dashboard",                  label: "Dashboard",         icon: LayoutDashboard },
  { href: "/dashboard/produtos",         label: "Produtos",          icon: Package },
  { href: "/dashboard/variacoes",        label: "Variações",         icon: Tags },
  { href: "/dashboard/custo-producao",   label: "Custo de Produção", icon: Factory },
  { href: "/dashboard/custo-operacional",label: "Custo Operacional", icon: Wallet },
  { href: "/dashboard/estoque",          label: "Estoque",           icon: Boxes },
  { href: "/dashboard/metas",            label: "Metas de Produção", icon: Target },
  { href: "/dashboard/relatorios",       label: "Relatórios",        icon: BarChart3 },
  { href: "/dashboard/usuarios",         label: "Usuários",          icon: Users },
]

const navLP = [
  { href: "/dashboard/catalogo", label: "Produtos na LP", icon: Images },
]

export default function Sidebar() {
  const pathname = usePathname()

  function isActive(href: string) {
    return pathname === href
  }

  return (
    <aside className="w-64 min-h-screen bg-[#0F1E3C] text-white flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/8">
        <div className="flex items-center gap-3">
          <Image
            src="/smsemfundo.png"
            alt="SM Confecções"
            width={36}
            height={18}
            className="brightness-0 invert object-contain"
          />
          <div>
            <p
              className="text-sm font-bold text-white leading-tight"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              SM Confecções
            </p>
            <p className="text-[10px] text-white/35 uppercase tracking-widest mt-0.5">Painel Interno</p>
          </div>
        </div>
      </div>

      {/* Nav principal */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? "bg-[#4361EE] text-white shadow-md shadow-[#4361EE]/20"
                  : "text-white/50 hover:bg-white/6 hover:text-white"
              }`}
            >
              <Icon size={16} className={active ? "opacity-100" : "opacity-60"} />
              {label}
            </Link>
          )
        })}

        <div className="pt-4 mt-2 border-t border-white/8">
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/25">
            Landing Page
          </p>
          {navLP.map(({ href, label, icon: Icon }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-[#4361EE] text-white shadow-md shadow-[#4361EE]/20"
                    : "text-white/50 hover:bg-white/6 hover:text-white"
                }`}
              >
                <Icon size={16} className={active ? "opacity-100" : "opacity-60"} />
                {label}
              </Link>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}
