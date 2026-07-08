"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { logout, getSession } from "@/lib/auth"
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react"
import {
  navTop, navGestao, navFinanceiro, navDTF, navProducao, navCadastros, navLP, navSistema,
} from "@/lib/navPages"
import type { NavItem } from "@/lib/navPages"

type Props = { collapsed: boolean; onToggle: () => void }

function NavSection({ label, items, isActive, collapsed }: {
  label: string; items: NavItem[]; isActive: (href: string) => boolean; collapsed: boolean
}) {
  if (items.length === 0) return null
  return (
    <div className="pt-3 mt-2 border-t border-white/8">
      {!collapsed && (
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/25">
          {label}
        </p>
      )}
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(href)
        return (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              collapsed ? "justify-center" : ""
            } ${
              active
                ? "bg-[#4361EE] text-white shadow-md shadow-[#4361EE]/20"
                : "text-white/50 hover:bg-white/6 hover:text-white"
            }`}
          >
            <Icon size={16} className={`flex-shrink-0 ${active ? "opacity-100" : "opacity-60"}`} />
            {!collapsed && <span className="truncate">{label}</span>}
          </Link>
        )
      })}
    </div>
  )
}

export default function Sidebar({ collapsed, onToggle }: Props) {
  const pathname     = usePathname()
  const router       = useRouter()
  const session      = getSession()
  const isAdmin      = session?.isAdmin ?? false
  const allowedPages = session?.allowedPages ?? []
  const canSee       = (href: string) => isAdmin || allowedPages.includes(href)
  const filterNav    = (items: NavItem[]) => items.filter(i => canSee(i.href))
  const [totalUnread, setTotalUnread] = useState(0)

  useEffect(() => {
    function fetchUnread() {
      fetch("/api/chat/conversations")
        .then(r => r.ok ? r.json() : [])
        .then((convs: Array<{ unread: number }>) => {
          setTotalUnread(convs.reduce((s, c) => s + (c.unread ?? 0), 0))
        })
        .catch(() => {})
    }
    fetchUnread()
    const t = setInterval(fetchUnread, 5_000)
    return () => clearInterval(t)
  }, [])

  async function handleLogout() {
    await logout()
    router.push("/login")
  }

  function isActive(href: string) { return pathname === href }

  return (
    <aside className={`${collapsed ? "w-[60px]" : "w-64"} h-screen bg-[#0F1E3C] text-white flex flex-col flex-shrink-0 transition-[width] duration-200`}>

      {/* Logo */}
      <div className={`flex items-center border-b border-white/8 flex-shrink-0 ${collapsed ? "justify-center px-3 py-4" : "gap-3 px-5 py-5"}`}>
        <Image
          src="/smsemfundo.png"
          alt="SM"
          width={collapsed ? 28 : 36}
          height={collapsed ? 14 : 18}
          className="brightness-0 invert object-contain flex-shrink-0"
        />
        {!collapsed && (
          <div>
            <p className="text-sm font-bold text-white leading-tight" style={{ fontFamily: "var(--font-playfair)" }}>SM Confecções</p>
            <p className="text-[10px] text-white/35 uppercase tracking-widest mt-0.5">Painel Interno</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 py-4 space-y-0.5 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`}>
        {filterNav(navTop).map(({ href, label, icon: Icon }) => {
          const active           = isActive(href)
          const isAutoatendimento = href === "/dashboard/autoatendimento/pedidos"
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                collapsed ? "justify-center" : ""
              } ${
                active
                  ? "bg-[#4361EE] text-white shadow-md shadow-[#4361EE]/20"
                  : "text-white/50 hover:bg-white/6 hover:text-white"
              }`}
            >
              <Icon size={16} className={`flex-shrink-0 ${active ? "opacity-100" : "opacity-60"}`} />
              {!collapsed && <span className="truncate flex-1">{label}</span>}
              {/* Badge não-lidas */}
              {isAutoatendimento && totalUnread > 0 && (
                collapsed ? (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#00A884]" />
                ) : (
                  <span className="ml-auto text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#00A884", color: "#fff" }}>
                    {totalUnread > 9 ? "9+" : totalUnread}
                  </span>
                )
              )}
            </Link>
          )
        })}

        <NavSection label="Gestão"       items={filterNav(navGestao)}     isActive={isActive} collapsed={collapsed} />
        <NavSection label="Financeiro"   items={filterNav(navFinanceiro)} isActive={isActive} collapsed={collapsed} />
        <NavSection label="DTF"          items={filterNav(navDTF)}        isActive={isActive} collapsed={collapsed} />
        <NavSection label="Produção"     items={filterNav(navProducao)}   isActive={isActive} collapsed={collapsed} />
        <NavSection label="Cadastros"    items={filterNav(navCadastros)}  isActive={isActive} collapsed={collapsed} />
        <NavSection label="Landing Page" items={filterNav(navLP)}         isActive={isActive} collapsed={collapsed} />
        <NavSection label="Sistema"      items={filterNav(navSistema)}    isActive={isActive} collapsed={collapsed} />
      </nav>

      {/* Bottom: usuário + logout + toggle */}
      <div className="flex-shrink-0 border-t border-white/8 p-3 space-y-1">
        {collapsed ? (
          <button
            onClick={handleLogout}
            title="Sair"
            className="w-full flex items-center justify-center p-2.5 rounded-xl text-white/40 hover:text-red-400 hover:bg-red-900/20 transition-colors"
          >
            <LogOut size={15} />
          </button>
        ) : (
          <div className="flex items-center gap-2 px-1 py-1">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-white/30 leading-none">Olá,</p>
              <p className="text-xs font-semibold text-white truncate mt-0.5">{session?.name ?? "Administrador"}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sair"
              className="flex items-center gap-1.5 text-[10px] font-semibold text-white/30 hover:text-red-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-900/20 flex-shrink-0"
            >
              <LogOut size={13} />
              Sair
            </button>
          </div>
        )}

        {/* Botão colapsar/expandir */}
        <button
          onClick={onToggle}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-white/25 hover:text-white/70 hover:bg-white/6 transition-colors text-xs"
        >
          {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>Recolher</span></>}
        </button>
      </div>
    </aside>
  )
}
