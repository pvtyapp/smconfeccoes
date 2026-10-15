"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Download, TrendingDown, TrendingUp } from "lucide-react"
import { todayBR, subDaysBR } from "@/lib/tz"
import { PLATAFORMA_MKT, plataformaDaLoja, ddmm, fmtBRL } from "@/lib/mktFechamento"

// Painel do marketplace (igual à aba da Vision, no visual da SM): SHP MARI, SHP SAMU e TKTK SAMU
// pelos lançamentos do outro PC. O dia fecha no dia seguinte.

type Tot = { pedidos: number; pecas: number; vendas: number; taxas: number; cupom: number; frete: number; ads: number; custo: number; lucro: number }
type Venda = { dia: string; loja: string; plataforma: string; pedido: string | null; sku: string | null; titulo: string | null; variacao: string | null; qtd: number; valor: number; taxa: number; cupom: number; frete: number; custo: number | null; lucro: number | null }
type Painel = {
  period: { from: string; to: string }
  loja: string | null
  lojas: string[]
  totais: Tot & { ticketMedio: number; lucroMedio: number }
  anterior: Tot
  variacao: { vendas: number | null; lucro: number | null; pedidos: number | null }
  incompletos: number
  divergencias: number
  faltando: { dia: string; loja: string }[]
  daily: { date: string; vendas: number | null; lucro: number | null; pedidos: number | null }[]
  porLoja: (Tot & { loja: string; plataforma: string; dias: number })[]
  produtos: { titulo: string; qtd: number; vendas: number; lucro: number; semCusto: number; lojas: string[]; pct: number; classe: "A" | "B" | "C" }[]
  vendas: Venda[]
  vendasTotal: number
}

type PeriodKey = "ontem" | "7d" | "15d" | "30d" | "mes" | "range"
const PERIODOS: { key: PeriodKey; label: string }[] = [
  { key: "ontem", label: "Ontem" }, { key: "7d", label: "7d" }, { key: "15d", label: "15d" },
  { key: "30d", label: "30d" }, { key: "mes", label: "Mês" }, { key: "range", label: "Período" },
]
function datas(k: PeriodKey, rs: string, re: string): [string, string] {
  const ontem = subDaysBR(1)
  switch (k) {
    case "ontem": return [ontem, ontem]
    case "7d": return [subDaysBR(7), ontem]
    case "15d": return [subDaysBR(15), ontem]
    case "30d": return [subDaysBR(30), ontem]
    case "mes": return [todayBR().slice(0, 8) + "01", todayBR()]
    case "range": return [rs, re]
  }
}

const pct = (v: number, base: number) => (base ? `${((v / base) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "0%")

function Dot({ loja }: { loja: string }) {
  const p = PLATAFORMA_MKT[plataformaDaLoja(loja)]
  return <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: p.cor }} title={p.nome} />
}

function Variacao({ v }: { v: number | null }) {
  if (v === null) return null
  const sobe = v >= 0
  return (
    <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${sobe ? "text-emerald-600" : "text-red-500"}`}>
      {sobe ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </span>
  )
}

const card = "bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm"

export default function MarketplacePainelPage() {
  const [period, setPeriod] = useState<PeriodKey>("7d")
  const [rs, setRs] = useState("")
  const [re, setRe] = useState("")
  const [loja, setLoja] = useState("todas")
  const [data, setData] = useState<Painel | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState("")
  const [produto, setProduto] = useState<string | null>(null)
  const [mostrar, setMostrar] = useState(50)

  useEffect(() => {
    const [from, to] = datas(period, rs, re)
    if (!from || !to) return
    setLoading(true)
    fetch(`/api/marketplace/painel?from=${from}&to=${to}&loja=${loja}`, { cache: "no-store" })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "erro"); return j })
      .then(j => { setData(j); setErro(""); setProduto(null); setMostrar(50) })
      .catch(e => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [period, rs, re, loja])

  const cabecalho = (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Painel Marketplace</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">SHP MARI, SHP SAMU e TKTK SAMU pelos lançamentos do outro PC. O dia entra no dia seguinte.</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/5 border border-[#0F1E3C]/8">
          {PERIODOS.map(o => (
            <button key={o.key} onClick={() => setPeriod(o.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${period === o.key ? "bg-[#4361EE] text-white shadow-sm" : "text-[#0F1E3C]/50 hover:text-[#0F1E3C] hover:bg-white/60"}`}>
              {o.label}
            </button>
          ))}
        </div>
        {period === "range" && (
          <div className="flex items-center gap-2">
            <input type="date" value={rs} onChange={e => setRs(e.target.value)} className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs" />
            <span className="text-xs text-[#0F1E3C]/40">até</span>
            <input type="date" value={re} onChange={e => setRe(e.target.value)} className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs" />
          </div>
        )}
      </div>
    </div>
  )

  if (!data) return <div className="max-w-[1500px] space-y-6">{cabecalho}<p className="text-sm text-[#0F1E3C]/40">{loading ? "Carregando..." : erro || ""}</p></div>

  const t = data.totais
  const margem = t.vendas ? (t.lucro / t.vendas) * 100 : 0
  const vendasFiltradas = produto ? data.vendas.filter(v => (v.titulo || "(sem título)") === produto) : data.vendas

  const exportarCsv = () => {
    const cab = ["Data", "Loja", "Pedido", "SKU", "Título", "Variação", "Qtd", "Valor", "Taxa", "Cupom", "Frete", "Custo", "Lucro"]
    const n = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","))
    const esc = (s: string | null) => `"${(s ?? "").replace(/"/g, '""')}"`
    const linhas = vendasFiltradas.map(v => [ddmm(v.dia), v.loja, esc(v.pedido), esc(v.sku), esc(v.titulo), esc(v.variacao), v.qtd, n(v.valor), n(v.taxa), n(v.cupom), n(v.frete), n(v.custo), n(v.lucro)].join(";"))
    const blob = new Blob(["﻿" + [cab.join(";"), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `marketplace_${data.period.from}_${data.period.to}${data.loja ? "_" + data.loja : ""}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const quebra = [
    { label: "Taxas", v: t.taxas }, { label: "Cupom", v: t.cupom }, { label: "Frete", v: t.frete },
    { label: "Ads", v: t.ads }, { label: "Custo das peças", v: t.custo },
  ]

  return (
    <div className="max-w-[1500px] space-y-8">
      {cabecalho}

      <div className="flex flex-wrap items-center gap-1.5">
        {["todas", ...data.lojas].map(l => (
          <button key={l} onClick={() => setLoja(l)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${loja === l ? "bg-[#4361EE]/10 text-[#4361EE] border-[#4361EE]/30" : "text-[#0F1E3C]/50 hover:text-[#0F1E3C] border-[#0F1E3C]/10 bg-white"}`}>
            {l !== "todas" && <Dot loja={l} />}{l === "todas" ? "Todas as lojas" : l}
          </button>
        ))}
        {loading && <span className="text-[#0F1E3C]/30 text-xs ml-2">atualizando...</span>}
      </div>

      {(data.faltando.length > 0 || data.incompletos > 0 || data.divergencias > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 space-y-1">
          {data.faltando.length > 0 && (
            <p>Sem lançamento: {data.faltando.slice(0, 8).map(f => `${ddmm(f.dia)} ${f.loja}`).join(", ")}{data.faltando.length > 8 ? ` e mais ${data.faltando.length - 8}` : ""}.</p>
          )}
          {data.divergencias > 0 && <p>{data.divergencias} lançamento(s) com pedidos diferentes do Upseller.</p>}
          {data.incompletos > 0 && <p>{data.incompletos} lançamento(s) com custo incompleto (sem itens ou SKU sem regra de custo): o lucro desses dias está maior que o real.</p>}
          <p><Link href="/dashboard/marketplace-lancamentos" className="font-semibold underline">Abrir os lançamentos</Link></p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Faturamento</p>
            <Variacao v={data.variacao.vendas} />
          </div>
          <p className="text-2xl font-black text-[#0F1E3C]">{fmtBRL(t.vendas)}</p>
          <p className="text-xs text-[#0F1E3C]/35 mt-1.5">vs {fmtBRL(data.anterior.vendas)} no período anterior</p>
        </div>
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Lucro</p>
            <Variacao v={data.variacao.lucro} />
          </div>
          <p className={`text-2xl font-black ${t.lucro < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtBRL(t.lucro)}</p>
          <p className="text-xs text-[#0F1E3C]/35 mt-1.5">margem {margem.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · já descontado o Ads</p>
        </div>
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Pedidos</p>
            <Variacao v={data.variacao.pedidos} />
          </div>
          <p className="text-2xl font-black text-[#0F1E3C]">{t.pedidos}</p>
          <p className="text-xs text-[#0F1E3C]/35 mt-1.5">{t.pecas} peças</p>
        </div>
        <div className={`${card} p-5`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">Ticket médio</p>
          <p className="text-2xl font-black text-[#0F1E3C]">{fmtBRL(t.ticketMedio)}</p>
          <p className={`text-xs mt-1.5 ${t.lucroMedio < 0 ? "text-red-500" : "text-[#0F1E3C]/35"}`}>lucro médio {fmtBRL(t.lucroMedio)} por pedido</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {quebra.map(q => (
          <div key={q.label} className={`${card} p-4`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40 mb-1">{q.label}</p>
            <p className="font-bold text-[#0F1E3C]">{fmtBRL(q.v)}</p>
            <p className="text-[11px] text-[#0F1E3C]/35">{pct(q.v, t.vendas)} do faturamento</p>
          </div>
        ))}
      </div>

      <GraficoDia daily={data.daily} />

      <div>
        <h3 className="text-xs font-bold text-[#4361EE] uppercase tracking-widest mb-3">Por loja</h3>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[#0F1E3C]/40 text-left">
                <th className="px-4 py-3 font-semibold">Loja</th>
                <th className="px-3 py-3 font-semibold text-right">Pedidos</th>
                <th className="px-3 py-3 font-semibold text-right">Faturamento</th>
                <th className="px-3 py-3 font-semibold text-right">Taxas</th>
                <th className="px-3 py-3 font-semibold text-right">Ads</th>
                <th className="px-3 py-3 font-semibold text-right">Custo</th>
                <th className="px-4 py-3 font-semibold text-right">Lucro</th>
              </tr>
            </thead>
            <tbody>
              {data.porLoja.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-[#0F1E3C]/30 text-xs">Nenhum lançamento no período.</td></tr>}
              {data.porLoja.map(l => (
                <tr key={l.loja} onClick={() => setLoja(l.loja)} className="border-t border-[#0F1E3C]/5 hover:bg-[#4361EE]/[0.03] cursor-pointer">
                  <td className="px-4 py-3 font-semibold text-[#0F1E3C]"><span className="flex items-center gap-2"><Dot loja={l.loja} />{l.loja}</span></td>
                  <td className="px-3 py-3 text-right text-[#0F1E3C]/70">{l.pedidos}</td>
                  <td className="px-3 py-3 text-right text-[#0F1E3C]">{fmtBRL(l.vendas)}</td>
                  <td className="px-3 py-3 text-right text-[#0F1E3C]/50">{fmtBRL(l.taxas + l.cupom + l.frete)}</td>
                  <td className="px-3 py-3 text-right text-[#0F1E3C]/50">{fmtBRL(l.ads)}</td>
                  <td className="px-3 py-3 text-right text-[#0F1E3C]/50">{fmtBRL(l.custo)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${l.lucro < 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {fmtBRL(l.lucro)} <span className="text-[#0F1E3C]/30 font-normal text-xs">({pct(l.lucro, l.vendas)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[#0F1E3C]/35 mt-2">Taxas = taxa da plataforma + cupom + frete. Clique numa loja pra ver só ela.</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-xs font-bold text-[#4361EE] uppercase tracking-widest">Produtos · curva ABC</h3>
          {produto && <button onClick={() => setProduto(null)} className="text-xs text-[#4361EE] hover:underline">limpar filtro do produto</button>}
        </div>
        <div className={`${card} divide-y divide-[#0F1E3C]/5`}>
          {data.produtos.length === 0 && <p className="px-4 py-6 text-center text-[#0F1E3C]/30 text-xs">Sem venda item a item no período.</p>}
          {data.produtos.slice(0, 20).map(p => (
            <button key={p.titulo} onClick={() => setProduto(produto === p.titulo ? null : p.titulo)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#4361EE]/[0.03] ${produto === p.titulo ? "bg-[#4361EE]/[0.06]" : ""}`}>
              <span className={`w-6 h-6 rounded-md text-[11px] font-black flex items-center justify-center shrink-0 ${p.classe === "A" ? "bg-emerald-100 text-emerald-700" : p.classe === "B" ? "bg-amber-100 text-amber-700" : "bg-[#0F1E3C]/5 text-[#0F1E3C]/40"}`}>{p.classe}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-[#0F1E3C] truncate">{p.titulo}</span>
                <span className="block text-[11px] text-[#0F1E3C]/40">{p.qtd} un · {p.lojas.join(", ")}{p.semCusto ? ` · ⚠ ${p.semCusto} sem custo` : ""}</span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-sm font-semibold text-[#0F1E3C]">{fmtBRL(p.vendas)}</span>
                <span className={`block text-[11px] ${p.lucro < 0 ? "text-red-500" : "text-[#0F1E3C]/40"}`}>{p.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · lucro {fmtBRL(p.lucro)}</span>
              </span>
            </button>
          ))}
        </div>
        {data.produtos.length > 20 && <p className="text-[11px] text-[#0F1E3C]/35 mt-2">Mostrando os 20 que mais faturam de {data.produtos.length}. Clique num produto pra filtrar a lista de vendas.</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-xs font-bold text-[#4361EE] uppercase tracking-widest">
            Vendas {produto && <span className="text-[#0F1E3C]/40 normal-case tracking-normal font-normal">· {produto}</span>}
            <span className="text-[#0F1E3C]/30 normal-case tracking-normal font-normal ml-2">{vendasFiltradas.length} item(ns)</span>
          </h3>
          <button onClick={exportarCsv} disabled={vendasFiltradas.length === 0}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#0F1E3C]/60 hover:text-[#0F1E3C] border border-[#0F1E3C]/12 rounded-lg px-3 py-1.5 bg-white disabled:opacity-30">
            <Download size={13} /> Exportar
          </button>
        </div>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[#0F1E3C]/40 text-left">
                <th className="px-4 py-3 font-semibold">Produto</th>
                <th className="px-3 py-3 font-semibold">Loja</th>
                <th className="px-3 py-3 font-semibold">Data</th>
                <th className="px-3 py-3 font-semibold text-right">Qtd</th>
                <th className="px-3 py-3 font-semibold text-right">Valor</th>
                <th className="px-3 py-3 font-semibold text-right">Taxas</th>
                <th className="px-3 py-3 font-semibold text-right">Custo</th>
                <th className="px-4 py-3 font-semibold text-right">Lucro</th>
              </tr>
            </thead>
            <tbody>
              {vendasFiltradas.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-[#0F1E3C]/30 text-xs">Nenhuma venda item a item no período.</td></tr>}
              {vendasFiltradas.slice(0, mostrar).map((v, i) => (
                <tr key={`${v.loja}-${v.pedido}-${i}`} className="border-t border-[#0F1E3C]/5">
                  <td className="px-4 py-2.5 max-w-[340px]">
                    <span className="block text-[#0F1E3C] truncate">{v.titulo || v.sku || "—"}</span>
                    {[v.variacao, v.sku && v.sku !== v.titulo ? v.sku : null].some(Boolean) && (
                      <span className="block text-[11px] text-[#0F1E3C]/35 truncate">{[v.variacao, v.sku && v.sku !== v.titulo ? v.sku : null].filter(Boolean).join(" · ")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[#0F1E3C]/70"><span className="flex items-center gap-1.5"><Dot loja={v.loja} />{v.loja}</span></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[#0F1E3C]/50">{ddmm(v.dia)}</td>
                  <td className="px-3 py-2.5 text-right text-[#0F1E3C]/70">{v.qtd}</td>
                  <td className="px-3 py-2.5 text-right text-[#0F1E3C]">{fmtBRL(v.valor)}</td>
                  <td className="px-3 py-2.5 text-right text-[#0F1E3C]/50">−{fmtBRL(v.taxa + v.cupom + v.frete)}</td>
                  <td className="px-3 py-2.5 text-right text-[#0F1E3C]/50">{v.custo === null ? <span className="text-amber-600">sem custo</span> : `−${fmtBRL(v.custo)}`}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${v.lucro === null ? "text-[#0F1E3C]/30" : v.lucro < 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {v.lucro === null ? "—" : <>{fmtBRL(v.lucro)} <span className="text-[#0F1E3C]/30 font-normal text-[11px]">{pct(v.lucro, v.valor)}</span></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
          <p className="text-[11px] text-[#0F1E3C]/35">Lucro por item é antes do Ads (o Ads entra no total da loja).</p>
          {vendasFiltradas.length > mostrar && <button onClick={() => setMostrar(m => m + 100)} className="text-xs text-[#4361EE] hover:underline">mostrar mais ({vendasFiltradas.length - mostrar})</button>}
        </div>
        {data.vendasTotal > data.vendas.length && <p className="text-[11px] text-[#0F1E3C]/35 mt-1">Período com {data.vendasTotal} itens: a tela traz os {data.vendas.length} mais recentes. Diminua o período pra ver o resto.</p>}
      </div>
    </div>
  )
}

// Faturamento por dia (azul claro) com o lucro dentro (azul forte; vermelho se deu prejuízo). Dia sem lançamento = cinza.
function GraficoDia({ daily }: { daily: Painel["daily"] }) {
  if (daily.length === 0) return null
  const max = Math.max(1, ...daily.map(d => d.vendas ?? 0))
  const labels = daily.length <= 15
  return (
    <div>
      <h3 className="text-xs font-bold text-[#4361EE] uppercase tracking-widest mb-3">Dia a dia</h3>
      <div className={`${card} p-5`}>
        <div className="flex items-end gap-1 h-40">
          {daily.map(d => {
            const v = d.vendas ?? 0
            const l = d.lucro ?? 0
            const title = d.vendas === null ? `${ddmm(d.date)}: sem lançamento` : `${ddmm(d.date)}: faturamento ${fmtBRL(v)} · lucro ${fmtBRL(l)} · ${d.pedidos} pedidos`
            return (
              <div key={d.date} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end" title={title}>
                {d.vendas === null || v === 0 ? (
                  <div className="w-full rounded-t-sm bg-[#0F1E3C]/8" style={{ height: "2%" }} />
                ) : (
                  <div className="w-full flex flex-col justify-end rounded-t-sm bg-[#4361EE]/30 hover:bg-[#4361EE]/40 overflow-hidden" style={{ height: `${Math.max(2, (v / max) * 100)}%` }}>
                    <div className={l < 0 ? "bg-red-500" : "bg-[#4361EE]"} style={{ height: `${Math.min(100, Math.max(3, (Math.abs(l) / v) * 100))}%` }} />
                  </div>
                )}
                {labels && <span className="text-[9px] text-[#0F1E3C]/35 mt-1.5 whitespace-nowrap">{ddmm(d.date)}</span>}
              </div>
            )
          })}
        </div>
        {!labels && (
          <div className="flex items-center justify-between text-[10px] text-[#0F1E3C]/35 mt-2">
            <span>{ddmm(daily[0].date)}</span><span>{ddmm(daily[daily.length - 1].date)}</span>
          </div>
        )}
        <div className="flex items-center gap-4 flex-wrap mt-3 text-[10px] text-[#0F1E3C]/45">
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#4361EE]/30" />faturamento</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#4361EE]" />lucro</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" />prejuízo</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#0F1E3C]/10" />sem lançamento</span>
        </div>
      </div>
    </div>
  )
}
