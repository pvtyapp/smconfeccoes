"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Package,
  FolderTree,
  Wallet,
  Boxes,
  Factory,
  TrendingUp,
  CalendarClock,
  UserRound,
  Users,
  Images,
  ShoppingBag,
  Receipt,
} from "lucide-react"

type NavItem = { href: string; label: string; icon: React.ElementType }

const navOperacional: NavItem[] = [
  { href: "/dashboard",                   label: "Dashboard",        icon: LayoutDashboard },
  { href: "/dashboard/categorias",        label: "Categorias",       icon: FolderTree },
  { href: "/dashboard/produtos",          label: "Produtos",         icon: Package },
  { href: "/dashboard/estoque",              label: "Estoque",              icon: Boxes },
  { href: "/dashboard/clientes-a-receber",  label: "Clientes a Receber",   icon: Receipt },
  { href: "/dashboard/custo-operacional",   label: "Custo Operacional",    icon: Wallet },
]

const navProducao: NavItem[] = [
  { href: "/dashboard/metricas",          label: "Métricas Produção x Vendas", icon: TrendingUp },
  { href: "/dashboard/programacao",       label: "Programação de Produção",    icon: CalendarClock },
  { href: "/dashboard/custo-producao",    label: "Custos de Produção",         icon: Factory },
]

const navCadastros: NavItem[] = [
  { href: "/dashboard/clientes",  label: "Clientes",  icon: UserRound },
  { href: "/dashboard/usuarios",  label: "Usuários",  icon: Users },
]

const navLP: NavItem[] = [
  { href: "/dashboard/catalogo", label: "Produtos na LP", icon: Images },
]

const navAutoatendimento: NavItem[] = [
  { href: "/dashboard/autoatendimento/pedidos", label: "Pedidos", icon: ShoppingBag },
]

function NavSection({ label, items, isActive }: { label: string; items: NavItem[]; isActive: (href: string) => boolean }) {
  return (
    <div className="pt-4 mt-2 border-t border-white/8">
      <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/25">
        {label}
      </p>
      {items.map(({ href, label, icon: Icon }) => {
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
  )
}

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

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {/* Bloco 1 — Operacional (sem label, é o bloco principal) */}
        {navOperacional.map(({ href, label, icon: Icon }) => {
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

        <NavSection label="Produção"         items={navProducao}        isActive={isActive} />
        <NavSection label="Cadastros"        items={navCadastros}       isActive={isActive} />
        <NavSection label="Landing Page"     items={navLP}              isActive={isActive} />
        <NavSection label="Autoatendimento"  items={navAutoatendimento} isActive={isActive} />
      </nav>
    </aside>
  )
}
