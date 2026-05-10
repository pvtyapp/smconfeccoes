"use client"

import Link from "next/link"
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
} from "lucide-react"

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/produtos", label: "Produtos", icon: Package },
  { href: "/dashboard/variacoes", label: "Variações", icon: Tags },
  { href: "/dashboard/custo-producao", label: "Custo de Produção", icon: Factory },
  { href: "/dashboard/custo-operacional", label: "Custo Operacional", icon: Wallet },
  { href: "/dashboard/estoque", label: "Estoque", icon: Boxes },
  { href: "/dashboard/metas", label: "Metas de Produção", icon: Target },
  { href: "/dashboard/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/dashboard/usuarios", label: "Usuários", icon: Users },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <div className="px-6 py-5 border-b border-gray-700">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">SM Confecções</p>
        <p className="text-sm text-gray-500 mt-0.5">Painel interno</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
