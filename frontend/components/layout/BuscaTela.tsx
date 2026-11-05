"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { NAV_GROUPS } from "@/lib/navPages"

// Ctrl+K: busca rápida de tela no painel (PIV 05/11). Digita parte do nome, Enter abre.
export default function BuscaTela({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const router = useRouter()
  const [q, setQ] = useState("")
  const [sel, setSel] = useState(0)
  const inp = useRef<HTMLInputElement>(null)
  const todas = useMemo(() => NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, grupo: g.label }))), [])
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  const lista = useMemo(() => todas.filter(i => norm(i.label + " " + i.grupo).includes(norm(q))), [todas, q])

  useEffect(() => { if (aberto) { setQ(""); setSel(0); setTimeout(() => inp.current?.focus(), 30) } }, [aberto])
  useEffect(() => { setSel(0) }, [q])

  if (!aberto) return null
  const ir = (href: string) => { onFechar(); router.push(href) }
  return (
    <div className="pn-busca-ov" onClick={onFechar}>
      <div className="pn-busca-box" role="dialog" aria-label="Buscar tela" onClick={e => e.stopPropagation()}>
        <input ref={inp} value={q} onChange={e => setQ(e.target.value)} placeholder="Ir para… (ex.: estoque, pdv, notas)"
          onKeyDown={e => {
            if (e.key === "Escape") onFechar()
            if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, lista.length - 1)) }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
            if (e.key === "Enter" && lista[sel]) ir(lista[sel].href)
          }} />
        <div className="pn-busca-lista">
          {lista.length === 0 && <p className="pn-busca-vazio">Nenhuma tela com esse nome.</p>}
          {lista.map((i, k) => {
            const Icon = i.icon
            return (
              <button key={i.href} type="button" className={k === sel ? "sel" : ""} onMouseEnter={() => setSel(k)} onClick={() => ir(i.href)}>
                <Icon size={16} /><span>{i.label}</span><small>{i.grupo}</small>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
