"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { logout, getSession } from "@/lib/auth"
import type { AuthSession } from "@/lib/types"
import { ChevronLeft, ChevronRight, ChevronDown, LogOut, Search } from "lucide-react"
import { NAV_GROUPS, FINANCE_PAGES, type NavItem } from "@/lib/navPages"
import { useAcesso } from "@/lib/acessoClient"

type Props = { collapsed: boolean; onToggle: () => void; onBuscar: () => void }

const AUTO = "/dashboard/autoatendimento/pedidos"

// Menu do painel (PIV 05/11): grupos por trabalho, indicador que desliza até a tela
// ativa, grupos recolhíveis e atalho Ctrl+K. A sessão (localStorage) só é lida depois
// de montar: lida durante a renderização, o HTML do servidor (sem sessão) e o do
// navegador saíam diferentes e todas as telas davam o erro #418 do React.
export default function Sidebar({ collapsed, onToggle, onBuscar }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const acesso = useAcesso()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [montado, setMontado] = useState(false)
  const [fechados, setFechados] = useState<string[]>([])
  const [totalUnread, setTotalUnread] = useState(0)
  const navRef = useRef<HTMLElement>(null)
  const [ind, setInd] = useState<{ top: number; h: number } | null>(null)

  useEffect(() => {
    setSession(getSession()); setMontado(true)
    try { setFechados(JSON.parse(localStorage.getItem("menu_fechados") || "[]")) } catch { /* ignora */ }
  }, [])

  useEffect(() => {
    function fetchUnread() {
      fetch("/api/chat/conversations")
        .then(r => r.ok ? r.json() : [])
        .then((convs: Array<{ unread: number }>) => setTotalUnread(convs.reduce((s, c) => s + (c.unread ?? 0), 0)))
        .catch(() => {})
    }
    fetchUnread()
    const t = setInterval(fetchUnread, 5_000)
    return () => clearInterval(t)
  }, [])

  const isAdmin = session?.isAdmin ?? false
  const allowed = useMemo(() => session?.allowedPages ?? [], [session])
  const grupos = useMemo(() => {
    if (!montado) return []
    const canSee = (href: string) => isAdmin || (allowed.includes(href) && (acesso.verFinanceiro || !FINANCE_PAGES.includes(href)))
    return NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(i => canSee(i.href)) })).filter(g => g.items.length)
  }, [montado, isAdmin, allowed, acesso.verFinanceiro])

  const ativo = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"))

  // indicador deslizante: mede o link ativo (relativo ao menu, contando a rolagem) e
  // anima até ele; mede de novo quando a fonte carrega ou algo muda de tamanho
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const medir = () => {
      const el = nav.querySelector<HTMLElement>("[data-ativo='1']")
      if (!el) { setInd(null); return }
      const a = el.getBoundingClientRect(), n = nav.getBoundingClientRect()
      setInd({ top: a.top - n.top + nav.scrollTop, h: a.height })
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(nav)
    nav.querySelectorAll(".pn-itens").forEach(e => ro.observe(e))
    document.fonts?.ready.then(medir)
    const t = setTimeout(medir, 350)
    return () => { ro.disconnect(); clearTimeout(t) }
  }, [pathname, grupos, collapsed, fechados])

  function alterna(label: string) {
    setFechados(f => {
      const n = f.includes(label) ? f.filter(x => x !== label) : [...f, label]
      try { localStorage.setItem("menu_fechados", JSON.stringify(n)) } catch { /* ignora */ }
      return n
    })
  }

  async function handleLogout() {
    await logout()
    router.push("/login")
  }

  const link = ({ href, label, icon: Icon }: NavItem) => {
    const on = ativo(href)
    return (
      <Link key={href} href={href} title={collapsed ? label : undefined} data-ativo={on ? "1" : "0"}
        className={`pn-link ${on ? "on" : ""} ${collapsed ? "mini" : ""}`}>
        <Icon size={17} className="pn-ico" />
        {!collapsed && <span className="pn-txt">{label}</span>}
        {href === AUTO && totalUnread > 0 && (
          collapsed ? <span className="pn-dot" /> : <span className="pn-badge">{totalUnread > 9 ? "9+" : totalUnread}</span>
        )}
      </Link>
    )
  }

  return (
    <aside className={`pn-side ${collapsed ? "mini" : ""}`}>
      <div className="pn-marca">
        <img src="/smsemfundo.png" alt="SM Confecções" />
        {!collapsed && <span>Painel</span>}
      </div>

      <button type="button" className={`pn-busca ${collapsed ? "mini" : ""}`} onClick={onBuscar} title="Buscar tela (Ctrl+K)">
        <Search size={15} />
        {!collapsed && <><span>Buscar tela</span><kbd>Ctrl K</kbd></>}
      </button>

      <nav ref={navRef} className="pn-nav">
        {ind && <span className="pn-ind" style={{ transform: `translateY(${ind.top}px)`, height: ind.h }} aria-hidden="true" />}
        {!montado && Array.from({ length: 9 }).map((_, i) => <span key={i} className="pn-esq" />)}
        {grupos.map(g => {
          const fechado = fechados.includes(g.label) && !g.items.some(i => ativo(i.href))
          return (
            <div key={g.label} className="pn-grupo">
              {!collapsed && (
                <button type="button" className="pn-gtit" onClick={() => alterna(g.label)} aria-expanded={!fechado}>
                  <span>{g.label}</span><ChevronDown size={13} className={fechado ? "fechado" : ""} />
                </button>
              )}
              {(!fechado || collapsed) && <div className="pn-itens">{g.items.map(link)}</div>}
            </div>
          )
        })}
      </nav>

      <div className="pn-pe">
        {!collapsed && (
          <div className="pn-user">
            <span className="pn-avatar">{(session?.name ?? "?").slice(0, 1).toUpperCase()}</span>
            <span className="pn-nome">{session?.name ?? ""}</span>
          </div>
        )}
        <button type="button" onClick={handleLogout} title="Sair" className="pn-sair"><LogOut size={15} />{!collapsed && <span>Sair</span>}</button>
        <button type="button" onClick={onToggle} title={collapsed ? "Expandir menu" : "Recolher menu"} className="pn-recolhe">
          {collapsed ? <ChevronRight size={15} /> : <><ChevronLeft size={15} /><span>Recolher</span></>}
        </button>
      </div>
    </aside>
  )
}
