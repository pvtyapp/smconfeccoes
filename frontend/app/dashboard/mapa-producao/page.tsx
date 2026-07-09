"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { fmtR } from "@/lib/format"

type CorteItem = { id: number; number: string; productName: string; createdAt: string; materiaisCount: number; coresCount: number }
type RevisaoItem = { id: number; number: string; productName: string; concludedAt: string; prioridade: number; cor: "vermelho" | "amarelo" | "verde" }
type EstoqueItem = { id: string; type: "in" | "out"; quantity: number; reason: string; createdAt: string; productName: string; color: string; size: string }
type VendaItem = { id: number; number: string; valor: number; createdAt: string; cliente?: string }

type MapaData = {
  dia: "hoje" | "ontem"
  corte: CorteItem[]
  revisao: RevisaoItem[]
  estoque: EstoqueItem[]
  dtf: VendaItem[]
  whatsapp: VendaItem[]
  balcao: VendaItem[]
}

// Zonas do mapa — mesmas coordenadas ajustadas no mockup, em % da imagem/vídeo
// (recorte de 5% em cima / 10% embaixo já aplicado no vídeo em si).
const ZONES = {
  balcao:   { left: 57, top: 12.2 },
  estoqueIn:  { left: 24, top: 30 },
  estoqueOut: { left: 33, top: 36 },
  revisao:  { left: 84, top: 41.1 },
  corte1:   { left: 20, top: 68.9 },
  corte2:   { left: 43, top: 80 },
  dtf:      { left: 80, top: 64.4 },
  whatsapp: { left: 92, top: 72.2 },
  ecommerce: { left: 86, top: 57 },
}

const REVISAO_TONE: Record<string, string> = {
  vermelho: "var(--danger)",
  amarelo:  "var(--warn)",
  verde:    "var(--money)",
}

// Agrupa uma lista em blocos de até `size` — cada bloco vira 1 balão só, pra
// não lotar a tela quando tiver muito evento no dia.
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Espalha N balões em torno de um centro de zona, num pequeno grid, pra não
// ficarem todos empilhados exatamente no mesmo pixel.
function scatter(center: { left: number; top: number }, index: number, total: number) {
  if (total <= 1) return center
  const perRow = Math.min(3, total)
  const row = Math.floor(index / perRow)
  const col = index % perRow
  const spacing = 7
  const offsetX = (col - (perRow - 1) / 2) * spacing
  const offsetY = row * spacing
  return { left: center.left + offsetX, top: center.top + offsetY }
}

type DetailPanel = {
  title: string
  eyebrow: string
  rows: { label: string; value: string }[]
} | null

export default function SemaforoMapaPage() {
  const [data, setData] = useState<MapaData | null>(null)
  const [dia, setDia] = useState<"hoje" | "ontem">("hoje")
  const [loading, setLoading] = useState(true)
  const [panel, setPanel] = useState<DetailPanel>(null)
  const [events, setEvents] = useState<{ id: number; emoji: string; left: number; top: number }[]>([])
  const eventIdRef = useRef(0)
  const prevCountsRef = useRef<Record<string, number>>({})

  const load = useCallback(async (d: "hoje" | "ontem") => {
    const res = await fetch(`/api/producao/mapa?dia=${d}`).catch(() => null)
    if (!res || !res.ok) return
    const json = await res.json()
    setData(json)
    setLoading(false)
  }, [])

  useEffect(() => { load(dia) }, [dia, load])

  useEffect(() => {
    const t = setInterval(() => load(dia), 30_000)
    return () => clearInterval(t)
  }, [dia, load])

  // Detecta itens novos comparando com a última carga — dispara um ícone
  // voando na hora que um evento novo aparece (venda, ordem, movimentação).
  useEffect(() => {
    if (!data) return
    const counts: Record<string, number> = {
      dtf: data.dtf.length, whatsapp: data.whatsapp.length, balcao: data.balcao.length,
      estoque: data.estoque.length, corte: data.corte.length,
    }
    const prev = prevCountsRef.current
    const spawn = (emoji: string, zone: { left: number; top: number }) => {
      const id = eventIdRef.current++
      setEvents(cur => [...cur, { id, emoji, left: zone.left, top: zone.top }])
      setTimeout(() => setEvents(cur => cur.filter(e => e.id !== id)), 2400)
    }
    if (prev.dtf !== undefined && counts.dtf > prev.dtf) spawn("🖨️", ZONES.dtf)
    if (prev.whatsapp !== undefined && counts.whatsapp > prev.whatsapp) spawn("📱", ZONES.whatsapp)
    if (prev.balcao !== undefined && counts.balcao > prev.balcao) spawn("💲", ZONES.balcao)
    if (prev.corte !== undefined && counts.corte > prev.corte) spawn("✂️", ZONES.corte1)
    prevCountsRef.current = counts
  }, [data])

  function openVendaPanel(eyebrow: string, items: VendaItem[]) {
    setPanel({
      eyebrow, title: `${items.length} venda${items.length !== 1 ? "s" : ""}`,
      rows: items.map(v => ({ label: `${v.number}${v.cliente ? " · " + v.cliente : ""}`, value: fmtR(v.valor) })),
    })
  }
  function openCortePanel(items: CorteItem[]) {
    setPanel({
      eyebrow: "Corte — ordem de produção", title: items.length === 1 ? items[0].number : `${items.length} ordens`,
      rows: items.map(o => ({ label: `${o.number} · ${o.productName}`, value: `${o.coresCount} cor(es)` })),
    })
  }
  function openRevisaoPanel(item: RevisaoItem) {
    setPanel({
      eyebrow: `Revisão — prioridade ${item.prioridade}`, title: item.number,
      rows: [
        { label: "Produto", value: item.productName },
        { label: "Cortada em", value: new Date(item.concludedAt).toLocaleString("pt-BR") },
      ],
    })
  }
  function openEstoquePanel(items: EstoqueItem[], tipo: "in" | "out") {
    setPanel({
      eyebrow: tipo === "in" ? "Estoque — entradas" : "Estoque — saídas",
      title: `${items.length} movimentação${items.length !== 1 ? "ões" : ""}`,
      rows: items.map(m => ({ label: `${m.productName} ${m.color}/${m.size}`, value: `${m.quantity} un` })),
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh] text-[#0F1E3C]/40 text-sm">
        Carregando mapa de produção…
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center h-[70vh] text-red-500 text-sm">
        Não consegui carregar os dados do mapa.
      </div>
    )
  }

  const corteChunks = chunk(data.corte, 5)
  const estoqueIn  = data.estoque.filter(e => e.type === "in")
  const estoqueOut = data.estoque.filter(e => e.type === "out")
  const estoqueInChunks  = chunk(estoqueIn, 5)
  const estoqueOutChunks = chunk(estoqueOut, 5)
  const dtfChunks      = chunk(data.dtf, 5)
  const whatsappChunks = chunk(data.whatsapp, 5)
  const balcaoChunks   = chunk(data.balcao, 5)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Mapa de Produção
          </h1>
          <p className="text-xs text-[#0F1E3C]/45 mt-0.5">Visão geral em tempo real dos setores da loja</p>
        </div>
        <div className="flex items-center gap-1 bg-[#0F1E3C]/6 rounded-xl p-1">
          {(["hoje", "ontem"] as const).map(d => (
            <button key={d} onClick={() => { setLoading(true); setDia(d) }}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                dia === d ? "bg-white text-[#0F1E3C] shadow-sm" : "text-[#0F1E3C]/45 hover:text-[#0F1E3C]/70"
              }`}>
              {d === "hoje" ? "Hoje" : "Ontem"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
      <div className="relative bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden shadow-sm flex justify-center mx-auto lg:mx-0">
        <div className="relative" style={{ height: "min(76vh, 780px)", aspectRatio: "780 / 1178", maxWidth: "100%" }}>
          <video
            src="/mapa-producao.mp4"
            poster="/mapa-producao-poster.jpg"
            autoPlay loop muted playsInline
            className="absolute inset-0 w-full h-full object-contain"
          />

          {/* Balcão */}
          {balcaoChunks.length === 0 ? null : balcaoChunks.map((grp, i) => {
            const pos = scatter(ZONES.balcao, i, balcaoChunks.length)
            return (
              <MapBubble key={`balcao-${i}`} left={pos.left} top={pos.top} emoji="💲"
                count={grp.length > 1 ? grp.length : undefined}
                onClick={() => openVendaPanel("Balcão (PDV)", grp)} />
            )
          })}
          {balcaoChunks.length === 0 && (
            <MapBubble left={ZONES.balcao.left} top={ZONES.balcao.top} emoji="💲" faded />
          )}

          {/* Estoque: entradas verdes, saídas vermelhas */}
          {estoqueInChunks.map((grp, i) => {
            const pos = scatter(ZONES.estoqueIn, i, estoqueInChunks.length)
            return (
              <MapBubble key={`ein-${i}`} left={pos.left} top={pos.top} emoji="📦"
                tone="var(--money)" count={grp.length > 1 ? grp.length : undefined}
                onClick={() => openEstoquePanel(grp, "in")} />
            )
          })}
          {estoqueOutChunks.map((grp, i) => {
            const pos = scatter(ZONES.estoqueOut, i, estoqueOutChunks.length)
            return (
              <MapBubble key={`eout-${i}`} left={pos.left} top={pos.top} emoji="📦"
                tone="var(--danger)" count={grp.length > 1 ? grp.length : undefined}
                onClick={() => openEstoquePanel(grp, "out")} />
            )
          })}
          {estoqueIn.length === 0 && estoqueOut.length === 0 && (
            <MapBubble left={ZONES.estoqueIn.left} top={ZONES.estoqueIn.top} emoji="📦" faded />
          )}

          {/* Revisão: fila de prioridade 1/2/3, vermelho -> amarelo -> verde */}
          {data.revisao.map((item, i) => {
            const pos = scatter(ZONES.revisao, i, data.revisao.length)
            return (
              <MapBubble key={`rev-${item.id}`} left={pos.left} top={pos.top} emoji="👕"
                tone={REVISAO_TONE[item.cor]} badge={item.prioridade}
                onClick={() => openRevisaoPanel(item)} />
            )
          })}
          {data.revisao.length === 0 && (
            <MapBubble left={ZONES.revisao.left} top={ZONES.revisao.top} emoji="👕" faded />
          )}

          {/* Corte: uma tesourinha por ordem (agrupada de 5 em 5) */}
          {corteChunks.map((grp, i) => {
            const pos = scatter(i < 3 ? ZONES.corte1 : ZONES.corte2, i % 3, Math.min(3, corteChunks.length))
            return (
              <MapBubble key={`corte-${i}`} left={pos.left} top={pos.top} emoji="✂️"
                count={grp.length > 1 ? grp.length : undefined}
                onClick={() => openCortePanel(grp)} />
            )
          })}
          {corteChunks.length === 0 && (
            <MapBubble left={ZONES.corte1.left} top={ZONES.corte1.top} emoji="✂️" faded />
          )}

          {/* DTF */}
          {dtfChunks.map((grp, i) => {
            const pos = scatter(ZONES.dtf, i, dtfChunks.length)
            return (
              <MapBubble key={`dtf-${i}`} left={pos.left} top={pos.top} emoji="🖨️"
                count={grp.length > 1 ? grp.length : undefined}
                onClick={() => openVendaPanel("DTF", grp)} />
            )
          })}
          {dtfChunks.length === 0 && <MapBubble left={ZONES.dtf.left} top={ZONES.dtf.top} emoji="🖨️" faded />}

          {/* WhatsApp */}
          {whatsappChunks.map((grp, i) => {
            const pos = scatter(ZONES.whatsapp, i, whatsappChunks.length)
            return (
              <MapBubble key={`wa-${i}`} left={pos.left} top={pos.top} emoji="📱" tone="var(--money)"
                count={grp.length > 1 ? grp.length : undefined}
                onClick={() => openVendaPanel("Vendas WhatsApp", grp)} />
            )
          })}
          {whatsappChunks.length === 0 && <MapBubble left={ZONES.whatsapp.left} top={ZONES.whatsapp.top} emoji="📱" faded />}

          {/* E-commerce — esqueleto, aba ainda não existe */}
          <MapBubble left={ZONES.ecommerce.left} top={ZONES.ecommerce.top} emoji="💻" faded />

          {/* eventos individuais voando (novo item detectado desde a última atualização) */}
          {events.map(e => (
            <span key={e.id} className="absolute pointer-events-none z-20 text-xl"
              style={{
                left: `${e.left}%`, top: `${e.top}%`,
                animation: "map-event-fly 2.4s ease-out forwards",
              }}>
              {e.emoji}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-3 w-full lg:w-56 flex-shrink-0">
        <SummaryCard emoji="✂️" label="Corte" value={`${data.corte.length}`} />
        <SummaryCard emoji="👕" label="Revisão" value={`${data.revisao.length}`} />
        <SummaryCard emoji="📦" label="Estoque" value={`${estoqueIn.length} in · ${estoqueOut.length} out`} />
        <SummaryCard emoji="💲" label="Balcão" value={fmtR(data.balcao.reduce((s, v) => s + Number(v.valor), 0))} />
        <SummaryCard emoji="🖨️" label="DTF" value={fmtR(data.dtf.reduce((s, v) => s + Number(v.valor), 0))} />
        <SummaryCard emoji="📱" label="WhatsApp" value={fmtR(data.whatsapp.reduce((s, v) => s + Number(v.valor), 0))} />
        <SummaryCard emoji="💻" label="E-commerce" value="Em breve" />
        <SummaryCard emoji="💰" label={`Total ${dia}`} value={fmtR(
          [...data.balcao, ...data.dtf, ...data.whatsapp].reduce((s, v) => s + Number(v.valor), 0)
        )} />
      </div>
      </div>

      {panel && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setPanel(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[80vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#0F1E3C]/8">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#4361EE]">{panel.eyebrow}</p>
              <h3 className="font-bold text-lg text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>{panel.title}</h3>
            </div>
            <div className="px-6 py-4 space-y-2 overflow-y-auto">
              {panel.rows.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[#0F1E3C]/60">{r.label}</span>
                  <span className="font-bold text-[#0F1E3C] tabular-nums">{r.value}</span>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-[#0F1E3C]/8">
              <button onClick={() => setPanel(null)}
                className="w-full py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451D1] transition-colors">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes map-event-fly {
          0%   { opacity: 0; transform: translate(-50%, 26px) scale(0.5); }
          14%  { opacity: 1; transform: translate(-50%, 0) scale(1.05); }
          80%  { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -46px) scale(0.85); }
        }
      `}</style>
    </div>
  )
}

function MapBubble({ left, top, emoji, tone, count, badge, faded, onClick }: {
  left: number; top: number; emoji: string
  tone?: string; count?: number; badge?: number; faded?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10 transition-transform hover:scale-110"
      style={{ left: `${left}%`, top: `${top}%`, opacity: faded ? 0.35 : 1, cursor: onClick ? "pointer" : "default" }}
    >
      <span
        className="relative flex items-center justify-center rounded-full bg-white shadow-lg text-base"
        style={{
          width: 34, height: 34,
          border: `2px solid ${tone ?? "#E4DFD3"}`,
          animation: onClick ? "map-bob 3.2s ease-in-out infinite" : undefined,
        }}
      >
        {emoji}
        {badge != null && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#0F1E3C] text-white text-[9px] font-bold flex items-center justify-center">
            {badge}
          </span>
        )}
        {count != null && (
          <span className="absolute -bottom-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#4361EE] text-white text-[9px] font-bold flex items-center justify-center">
            ×{count}
          </span>
        )}
      </span>
      <style jsx>{`
        @keyframes map-bob {
          0%, 100% { margin-top: 0; }
          50% { margin-top: -4px; }
        }
      `}</style>
    </button>
  )
}

function SummaryCard({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#0F1E3C]/8 px-3 py-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40">
        <span className="text-sm">{emoji}</span>{label}
      </div>
      <p className="text-sm font-bold text-[#0F1E3C] tabular-nums">{value}</p>
    </div>
  )
}
