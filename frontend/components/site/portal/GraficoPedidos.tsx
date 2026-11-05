"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Pedido } from "./PedidosCliente"
import { brl } from "../util"

// Volume de pedidos do cliente (PIV 05/11): mini gráfico de 30 dias no card e,
// clicando, o gráfico grande com período (7/30/90 dias ou datas) e peças/R$.
// Série única, cor única (royal validado contra o fundo branco), barras finas
// com ponta arredondada, grade fina, tooltip por barra. Cancelado não conta.

type Ponto = { ini: string; fim: string; pecas: number; valor: number; pedidos: number }
type Metrica = "pecas" | "valor"

const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const somaDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return dia(d) }
const curta = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
const fmt = (m: Metrica, v: number) => (m === "valor" ? brl(v) : `${v} ${v === 1 ? "peça" : "peças"}`)

function serie(pedidos: Pedido[], de: string, ate: string): Ponto[] {
  const porDia = new Map<string, { pecas: number; valor: number; pedidos: number }>()
  for (const o of pedidos) {
    if (o.status === "cancelado") continue
    const k = dia(new Date(o.createdAt))
    if (k < de || k > ate) continue
    const a = porDia.get(k) ?? { pecas: 0, valor: 0, pedidos: 0 }
    a.pecas += o.items.reduce((n, i) => n + Number(i.qty), 0); a.valor += Number(o.totalValue ?? 0); a.pedidos += 1
    porDia.set(k, a)
  }
  const dias: Ponto[] = []
  for (let d = de; d <= ate; d = somaDias(d, 1)) { const a = porDia.get(d); dias.push({ ini: d, fim: d, pecas: a?.pecas ?? 0, valor: a?.valor ?? 0, pedidos: a?.pedidos ?? 0 }) }
  if (dias.length <= 62) return dias
  // período longo: junta por semana pra barra não virar fio
  const semanas: Ponto[] = []
  for (let i = 0; i < dias.length; i += 7) {
    const bloco = dias.slice(i, i + 7)
    semanas.push({ ini: bloco[0].ini, fim: bloco[bloco.length - 1].fim, pecas: bloco.reduce((s, p) => s + p.pecas, 0), valor: bloco.reduce((s, p) => s + p.valor, 0), pedidos: bloco.reduce((s, p) => s + p.pedidos, 0) })
  }
  return semanas
}

function teto(v: number) {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

function Barras({ pontos, metrica, grande }: { pontos: Ponto[]; metrica: Metrica; grande?: boolean }) {
  const [foco, setFoco] = useState<number | null>(null)
  // o grande desenha na largura real (no celular o texto dos eixos não encolhe)
  const caixa = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(860)
  useEffect(() => {
    if (!grande || !caixa.current) return
    const ro = new ResizeObserver(([e]) => setLargura(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(caixa.current)
    return () => ro.disconnect()
  }, [grande])
  const W = grande ? largura : 300, H = grande ? (largura < 500 ? 220 : 300) : 64
  const padL = grande ? (largura < 500 ? 48 : 64) : 0, padB = grande ? 28 : 0, padT = grande ? 20 : 2
  const vals = pontos.map((p) => p[metrica])
  const max = teto(Math.max(...vals, 0))
  const slot = (W - padL) / Math.max(1, pontos.length)
  const larg = Math.min(24, Math.max(2, slot - 2))
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  const base = H - padB
  const iMax = vals.indexOf(Math.max(...vals))
  const passo = Math.ceil(pontos.length / (grande ? Math.max(3, Math.floor(largura / 105)) : 1))
  const barra = (x: number, top: number) => {
    const h = base - top; if (h <= 0) return ""
    const r = Math.min(4, h, larg / 2)
    return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + larg - r} Q${x + larg},${top} ${x + larg},${top + r} V${base} Z`
  }
  const p = foco !== null ? pontos[foco] : null
  return (
    <div className="gf-plot" ref={caixa}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" style={{ height: H }}
        aria-label={`Volume de ${metrica === "valor" ? "valor" : "peças"} por ${pontos[0]?.ini === pontos[0]?.fim ? "dia" : "semana"}, de ${curta(pontos[0]?.ini ?? "")} a ${curta(pontos[pontos.length - 1]?.fim ?? "")}`}>
        {grande && [0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} className="gf-grade" />
            <text x={padL - 8} y={y(max * f) + 4} textAnchor="end" className="gf-eixo">{metrica === "valor" ? brl(max * f).replace(",00", "") : max * f}</text>
          </g>
        ))}
        {!grande && <line x1={0} x2={W} y1={base} y2={base} className="gf-grade" />}
        {pontos.map((pt, i) => {
          const x = padL + i * slot + (slot - larg) / 2
          return (
            <g key={pt.ini} onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)} onClick={() => setFoco(i)}>
              <rect x={padL + i * slot} y={0} width={slot} height={H} fill="transparent" />
              <path d={barra(x, y(pt[metrica]))} className={`gf-barra ${foco === i ? "foco" : ""} ${foco !== null && foco !== i ? "apagada" : ""}`} />
              {grande && i % passo === 0 && <text x={padL + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="gf-eixo">{curta(pt.ini)}</text>}
            </g>
          )
        })}
        {grande && vals[iMax] > 0 && foco === null && (
          <text x={Math.min(W - 4, Math.max(padL + 4, padL + iMax * slot + slot / 2))} y={y(vals[iMax]) - 6}
            textAnchor={padL + iMax * slot + slot / 2 > W - 60 ? "end" : padL + iMax * slot + slot / 2 < padL + 60 ? "start" : "middle"} className="gf-rotulo">{fmt(metrica, vals[iMax])}</text>
        )}
      </svg>
      {grande && p && (
        <div className="gf-tip" style={{ left: `${((padL + (foco! + 0.5) * slot) / W) * 100}%` }}>
          <b>{p.ini === p.fim ? curta(p.ini) : `${curta(p.ini)} a ${curta(p.fim)}`}</b>
          <span>{fmt("pecas", p.pecas)}</span><span>{brl(p.valor)}</span><span>{p.pedidos} {p.pedidos === 1 ? "pedido" : "pedidos"}</span>
        </div>
      )}
    </div>
  )
}

export function CardGrafico({ pedidos, onAbrir }: { pedidos: Pedido[]; onAbrir: () => void }) {
  const hoje = dia(new Date())
  const pts = useMemo(() => serie(pedidos, somaDias(hoje, -29), hoje), [pedidos, hoje])
  const pecas = pts.reduce((s, p) => s + p.pecas, 0), valor = pts.reduce((s, p) => s + p.valor, 0), n = pts.reduce((s, p) => s + p.pedidos, 0)
  return (
    <button type="button" className="pt-card gf-card" onClick={onAbrir} aria-label="Abrir gráfico de pedidos">
      <small>Seus pedidos · 30 dias</small>
      <b>{pecas} {pecas === 1 ? "peça" : "peças"}</b>
      <Barras pontos={pts} metrica="pecas" />
      <span>{n} {n === 1 ? "pedido" : "pedidos"} · {brl(valor)} <em>ver maior →</em></span>
    </button>
  )
}

export function ModalGrafico({ pedidos, onFechar }: { pedidos: Pedido[]; onFechar: () => void }) {
  const hoje = dia(new Date())
  const [de, setDe] = useState(somaDias(hoje, -29))
  const [ate, setAte] = useState(hoje)
  const [metrica, setMetrica] = useState<Metrica>("pecas")
  const [lista, setLista] = useState(false)
  const preset = (n: number) => { setDe(somaDias(hoje, -(n - 1))); setAte(hoje) }
  const dias = Math.round((new Date(ate + "T12:00:00").getTime() - new Date(de + "T12:00:00").getTime()) / 86400000) + 1
  const pts = useMemo(() => (de <= ate ? serie(pedidos, de, ate) : []), [pedidos, de, ate])
  const pecas = pts.reduce((s, p) => s + p.pecas, 0), valor = pts.reduce((s, p) => s + p.valor, 0), n = pts.reduce((s, p) => s + p.pedidos, 0)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar() }
    addEventListener("keydown", esc); document.body.style.overflow = "hidden"
    return () => { removeEventListener("keydown", esc); document.body.style.overflow = "" }
  }, [onFechar])

  return (
    <div className="gf-ov" onClick={onFechar}>
      <div className="gf-modal" role="dialog" aria-modal="true" aria-label="Volume de pedidos" onClick={(e) => e.stopPropagation()}>
        <div className="gf-topo">
          <div><span className="eye">Seus pedidos</span><p className="tit">Volume no período</p></div>
          <button className="x" type="button" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <div className="gf-filtros">
          <div className="tabs" role="group" aria-label="Período">
            {[7, 30, 90].map((k) => <button key={k} type="button" aria-pressed={dias === k && ate === hoje} onClick={() => preset(k)}>{k} dias</button>)}
          </div>
          <label>De <input type="date" value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
          <label>Até <input type="date" value={ate} min={de} max={hoje} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
          <div className="tabs" role="group" aria-label="Mostrar">
            <button type="button" aria-pressed={metrica === "pecas"} onClick={() => setMetrica("pecas")}>Peças</button>
            <button type="button" aria-pressed={metrica === "valor"} onClick={() => setMetrica("valor")}>R$</button>
          </div>
        </div>
        <div className="gf-totais">
          <div><small>Peças</small><b>{pecas}</b></div>
          <div><small>Valor</small><b>{brl(valor)}</b></div>
          <div><small>Pedidos</small><b>{n}</b></div>
          <div><small>Média por pedido</small><b>{n ? brl(valor / n) : "–"}</b></div>
        </div>
        {n === 0 ? <p className="obs">Nenhum pedido nesse período.</p> : lista ? (
          <div className="gw"><table className="gr">
            <thead><tr><th>{pts[0]?.ini === pts[0]?.fim ? "Dia" : "Semana"}</th><th>Peças</th><th>Valor</th><th>Pedidos</th></tr></thead>
            <tbody>{pts.filter((p) => p.pedidos).map((p) => (
              <tr key={p.ini}><td>{p.ini === p.fim ? curta(p.ini) : `${curta(p.ini)} a ${curta(p.fim)}`}</td><td>{p.pecas}</td><td>{brl(p.valor)}</td><td>{p.pedidos}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Barras pontos={pts} metrica={metrica} grande />}
        {n > 0 && <button className="link" type="button" onClick={() => setLista((v) => !v)}>{lista ? "Ver gráfico" : "Ver em lista"}</button>}
      </div>
    </div>
  )
}
