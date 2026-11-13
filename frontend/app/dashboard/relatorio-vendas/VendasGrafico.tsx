"use client"

// Gráfico do volume de vendas do período (PIV 12/11/2026: "um gráfico pra acompanhar as altas e quedas").
// Usa os mesmos pedidos que a tela já carregou (só vendas feitas, como os cartões). Receita segue a regra do prazo
// (PIV 13/11): venda a prazo não soma no dia da venda, a baixa soma na hora em que o dinheiro entrou. "Hoje"/"Ontem" = por hora; o resto = por dia.
// A linha tracejada é o período anterior do mesmo tamanho, buscado na mesma API, com o mesmo filtro de canal.
// Um eixo só: receita, pedidos e peças trocam pelo botão (escalas diferentes não dividem o mesmo gráfico).

import React, { useEffect, useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { TZ } from "@/lib/tz"
import { fmtR } from "@/lib/format"

type Item = { productName: string; qty: number }
export type PedidoGrafico = { number: string; source: string; status: string; totalValue: string | null; createdAt: string; contactName: string | null; items: Item[] | null; dueDate?: string | null }
export type RecebimentoGrafico = { source: string; contactName: string | null; amount: number; pagoEm: string }
type Evento = { iso: string; receita: number; pedidos: number; pecas: number }
type Metrica = "receita" | "pedidos" | "pecas"

const METRICAS: { key: Metrica; label: string }[] = [
  { key: "receita", label: "Receita" },
  { key: "pedidos", label: "Pedidos" },
  { key: "pecas",   label: "Peças"   },
]
const COR = "#4361EE", COR_ANT = "#0F1E3C"

const isDtf = (n: string) => n.toLowerCase().startsWith("dtf")
const diaBR  = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ })
const horaBR = (iso: string) => Number(new Date(iso).toLocaleString("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }))
const addDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const difDias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const rotDia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]
const semana = (d: string) => SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]

const valor = (e: Evento, m: Metrica) => e[m]
const fmt = (v: number, m: Metrica) => m === "receita" ? fmtR(v) : v.toLocaleString("pt-BR")

// mesmo filtro de canal/busca da tela
// Pedido = 1 evento no dia da venda (peças e pedidos sempre; receita só se à vista).
// Baixa de prazo = evento no dia do pagamento, só com a receita.
function eventos(lista: PedidoGrafico[], recebs: RecebimentoGrafico[], fonte: string, busca: string): Evento[] {
  const q = busca.trim().toLowerCase()
  const peds = lista.filter(o => {
    const venda = o.status === "concluido" || (o.source === "pdv" && o.status === "pronto" && !!o.dueDate)
    if (!venda) return false
    if (fonte === "manual" && o.number.startsWith("COB-")) return false
    if (q && !(o.contactName ?? "").toLowerCase().includes(q)) return false
    return fonte === "all" || o.source === fonte
  }).map(o => ({
    iso: o.createdAt,
    receita: o.dueDate ? 0 : Number(o.totalValue ?? 0),
    pedidos: 1,
    pecas: (o.items ?? []).filter(i => !isDtf(i.productName)).reduce((s, i) => s + i.qty, 0),
  }))
  const recs = fonte === "manual" || fonte === "avarias" ? [] : recebs.filter(r =>
    (fonte === "all" || r.source === fonte) && (!q || (r.contactName ?? "").toLowerCase().includes(q))
  ).map(r => ({ iso: r.pagoEm, receita: Number(r.amount), pedidos: 0, pecas: 0 }))
  return [...peds, ...recs]
}

export default function VendasGrafico({ pedidos, recebimentos = [], de, ate, fonte, busca }: {
  pedidos: PedidoGrafico[]; recebimentos?: RecebimentoGrafico[]; de: string; ate: string; fonte: string; busca: string
}) {
  const [metrica, setMetrica] = useState<Metrica>("receita")
  const [anteriores, setAnteriores] = useState<{ pedidos: PedidoGrafico[]; recebimentos: RecebimentoGrafico[] } | null>(null)
  const dias = difDias(de, ate) + 1
  const porHora = dias === 1
  const antDe = addDias(de, -dias), antAte = addDias(de, -1)

  useEffect(() => {
    let vivo = true
    setAnteriores(null)
    fetch(`/api/relatorio-vendas?${new URLSearchParams({ from: antDe, to: antAte })}`)
      .then(r => r.json()).then(d => { if (vivo) setAnteriores({
        pedidos: Array.isArray(d.orders) ? d.orders : [],
        recebimentos: Array.isArray(d.recebimentos) ? d.recebimentos : [],
      }) })
      .catch(() => { if (vivo) setAnteriores({ pedidos: [], recebimentos: [] }) })
    return () => { vivo = false }
  }, [antDe, antAte])

  const { pontos, total, totalAnt, media, melhor, pior } = useMemo(() => {
    const atual = eventos(pedidos, recebimentos, fonte, busca)
    const ant = anteriores ? eventos(anteriores.pedidos, anteriores.recebimentos, fonte, busca) : null
    const n = porHora ? 24 : dias
    const chave = (iso: string, base: string) => porHora ? horaBR(iso) : difDias(base, diaBR(iso))
    const serie = new Array(n).fill(0), serieAnt = new Array(n).fill(0)
    for (const e of atual) { const k = chave(e.iso, de); if (k >= 0 && k < n) serie[k] += valor(e, metrica) }
    if (ant) for (const e of ant) { const k = chave(e.iso, antDe); if (k >= 0 && k < n) serieAnt[k] += valor(e, metrica) }
    // hoje: não desenha as horas que ainda não chegaram
    const agora = porHora && de === new Date().toLocaleDateString("en-CA", { timeZone: TZ }) ? horaBR(new Date().toISOString()) : 23
    const pontos = serie.map((v, i) => {
      const dia = porHora ? de : addDias(de, i)
      return {
        rotulo: porHora ? `${String(i).padStart(2, "0")}h` : rotDia(dia),
        detalhe: porHora ? `${String(i).padStart(2, "0")}h às ${String(i).padStart(2, "0")}h59` : `${semana(dia)}, ${rotDia(dia)}`,
        detalheAnt: porHora ? "mesma hora do dia anterior" : `${semana(addDias(antDe, i))}, ${rotDia(addDias(antDe, i))}`,
        v: porHora && i > agora ? null : v,
        ant: ant ? serieAnt[i] : null,
      }
    })
    const validos = pontos.filter(p => p.v != null) as { rotulo: string; detalhe: string; v: number }[]
    const total = validos.reduce((s, p) => s + p.v, 0)
    const totalAnt = ant ? serieAnt.reduce((s, v) => s + v, 0) : null
    const media = validos.length ? total / validos.length : 0
    const comVenda = validos.filter(p => p.v > 0)
    const melhor = comVenda.length ? comVenda.reduce((a, b) => (b.v > a.v ? b : a)) : null
    const pior = !porHora && validos.length > 1 ? validos.reduce((a, b) => (b.v < a.v ? b : a)) : null
    return { pontos, total, totalAnt, media, melhor, pior }
  }, [pedidos, recebimentos, anteriores, fonte, busca, metrica, de, antDe, dias, porHora])

  const varPct = totalAnt != null && totalAnt > 0 ? ((total - totalAnt) / totalAnt) * 100 : null
  const unidade = porHora ? "hora" : "dia"

  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#0F1E3C]">Volume de vendas {porHora ? "por hora" : "por dia"}</p>
          <p className="text-[11px] text-[#0F1E3C]/40 mt-0.5">
            Só pedidos concluídos{(totalAnt ?? 0) > 0 ? <> · linha tracejada = {porHora ? "dia anterior" : `os ${dias} dias anteriores`}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/5 border border-[#0F1E3C]/8">
          {METRICAS.map(({ key, label }) => (
            <button key={key} onClick={() => setMetrica(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${metrica === key ? "bg-[#4361EE] text-white shadow-sm" : "text-[#0F1E3C]/50 hover:text-[#0F1E3C] hover:bg-white/60"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <div><span className="text-[#0F1E3C]/40">Total </span><b className="text-[#0F1E3C] tabular-nums">{fmt(total, metrica)}</b></div>
        <div>
          <span className="text-[#0F1E3C]/40">vs anterior </span>
          {varPct == null
            ? <b className="text-[#0F1E3C]/40">{anteriores == null ? "…" : "sem venda antes"}</b>
            : <b className={`tabular-nums ${varPct >= 0 ? "text-emerald-700" : "text-red-600"}`}>{varPct >= 0 ? "▲" : "▼"} {Math.abs(varPct).toFixed(0)}%</b>}
          {totalAnt != null && <span className="text-[#0F1E3C]/35"> ({fmt(totalAnt, metrica)})</span>}
        </div>
        <div><span className="text-[#0F1E3C]/40">Média por {unidade} </span><b className="text-[#0F1E3C] tabular-nums">{fmt(metrica === "receita" ? media : Math.round(media * 10) / 10, metrica)}</b></div>
        {melhor && <div><span className="text-[#0F1E3C]/40">Melhor </span><b className="text-[#0F1E3C]">{melhor.detalhe}</b> <span className="text-[#0F1E3C]/50 tabular-nums">{fmt(melhor.v, metrica)}</span></div>}
        {pior && melhor && pior.detalhe !== melhor.detalhe && <div><span className="text-[#0F1E3C]/40">Mais fraco </span><b className="text-[#0F1E3C]">{pior.detalhe}</b> <span className="text-[#0F1E3C]/50 tabular-nums">{fmt(pior.v, metrica)}</span></div>}
      </div>

      <div className="h-64 w-full min-w-0" role="img" aria-label={`Volume de vendas ${porHora ? "por hora" : "por dia"}: total ${fmt(total, metrica)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={pontos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="vg-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COR} stopOpacity={0.22} />
                <stop offset="100%" stopColor={COR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#0F1E3C" strokeOpacity={0.07} />
            <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: "#0F1E3C", fillOpacity: 0.45 }} tickLine={false} axisLine={{ stroke: "#0F1E3C", strokeOpacity: 0.12 }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={{ fontSize: 11, fill: "#0F1E3C", fillOpacity: 0.45 }} tickLine={false} axisLine={false} width={metrica === "receita" ? 64 : 36} allowDecimals={metrica === "receita"}
              tickFormatter={(v: number) => metrica === "receita" ? (v >= 1000 ? `R$${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : `R$${v.toFixed(0)}`) : String(v)} />
            {media > 0 && <ReferenceLine y={media} stroke="#0F1E3C" strokeOpacity={0.3} strokeDasharray="2 4" label={{ value: "média", position: "insideTopRight", fontSize: 10, fill: "#0F1E3C", fillOpacity: 0.45 }} />}
            <Tooltip
              cursor={{ stroke: "#0F1E3C", strokeOpacity: 0.2, strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as (typeof pontos)[number]
                return (
                  <div className="bg-white rounded-xl border border-[#0F1E3C]/10 shadow-lg px-3 py-2 text-xs">
                    <p className="font-semibold text-[#0F1E3C]">{p.detalhe}</p>
                    <p className="text-[#0F1E3C] tabular-nums mt-0.5"><span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: COR }} />{p.v == null ? "—" : fmt(p.v, metrica)}</p>
                    {p.ant != null && <p className="text-[#0F1E3C]/50 tabular-nums"><span className="inline-block w-2 border-t-2 border-dashed mr-1.5 align-middle" style={{ borderColor: COR_ANT }} />{p.detalheAnt}: {fmt(p.ant, metrica)}</p>}
                  </div>
                )
              }}
            />
            {anteriores && (totalAnt ?? 0) > 0 && <Line type="monotone" dataKey="ant" stroke={COR_ANT} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />}
            <Area type="monotone" dataKey="v" stroke={COR} strokeWidth={2} fill="url(#vg-fill)" connectNulls={false}
              dot={pontos.length <= 31 ? { r: 2.5, fill: COR, stroke: "#fff", strokeWidth: 1.5 } : false}
              activeDot={{ r: 5, fill: COR, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
