"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { todayBR } from "@/lib/tz"
import { ddmm, fmtBRL } from "@/lib/mktFechamento"

// Dashboard (PIV 15/10, igual à Vision): faturamento por dia em barras empilhadas,
// azul forte = venda direta (balcão, WhatsApp, site, DTF, avarias), azul claro = marketplace
// (lançamentos do outro PC, o dia entra no dia seguinte). Cartões de lucro ao lado.

type Resp = {
  daily: { date: string; direta: number; marketplace: number | null }[]
  marketplace: { vendas: number; lucro: number; pedidos: number; diasIncompletos: string[] }
}

export default function FaturamentoChart({ start, end, resultadoDireto }: { start: string; end: string; resultadoDireto: number | null }) {
  const [data, setData] = useState<Resp | null>(null)

  useEffect(() => {
    if (!start || !end) return
    let vivo = true
    fetch(`/api/dashboard/marketplace?from=${start}&to=${end}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (vivo) setData(j) })
      .catch(() => { if (vivo) setData(null) })
    return () => { vivo = false }
  }, [start, end])

  if (!data) return <div className="h-[260px] rounded-2xl bg-[#0F1E3C]/4 animate-pulse" />

  const daily = data.daily.map(d => ({ ...d, total: d.direta + (d.marketplace ?? 0) }))
  const max = Math.max(1, ...daily.map(d => d.total))
  const labels = daily.length <= 15
  const hoje = todayBR()
  const faltando = data.marketplace.diasIncompletos
  const soHoje = faltando.length === 1 && faltando[0] === hoje
  const lucroTotal = resultadoDireto === null ? null : resultadoDireto + data.marketplace.lucro

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-3">
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5 flex flex-col">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#0F1E3C]/40 mb-3">Faturamento por dia</p>
        <div className="flex items-end gap-1 h-40 lg:h-auto lg:flex-1 lg:min-h-40">
          {daily.map(d => {
            const pct = Math.max(2, (d.total / max) * 100)
            const mkt = d.marketplace ?? 0
            const title = `${ddmm(d.date)}: ${fmtBRL(d.total)}\nVenda direta: ${fmtBRL(d.direta)}\nMarketplace: ${d.marketplace === null ? "sem lançamento" : fmtBRL(mkt)}`
            return (
              <div key={d.date} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end" title={title}>
                {d.total > 0 ? (
                  <div className="w-full flex flex-col justify-end group" style={{ height: `${pct}%` }}>
                    {mkt > 0 && <div className="w-full rounded-t-sm bg-[#8FA5F5] group-hover:bg-[#7B94F2]" style={{ height: `${(mkt / d.total) * 100}%` }} />}
                    {d.direta > 0 && <div className={`w-full bg-[#4361EE] group-hover:bg-[#3451D1] ${mkt > 0 ? "" : "rounded-t-sm"}`} style={{ height: `${(d.direta / d.total) * 100}%` }} />}
                  </div>
                ) : (
                  <div className="w-full rounded-t-sm bg-[#0F1E3C]/8" style={{ height: "2%" }} />
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
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#4361EE]" />venda direta</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#8FA5F5]" />marketplace</span>
        </div>
        {faltando.length > 0 && (
          <p className="text-[10px] text-[#0F1E3C]/35 mt-2">
            {soHoje
              ? "O marketplace de hoje entra amanhã, quando o outro PC fecha o dia."
              : <>Marketplace incompleto em: {faltando.slice(0, 8).map(ddmm).join(", ")}{faltando.length > 8 ? ` e mais ${faltando.length - 8}` : ""}. <Link href="/dashboard/marketplace-lancamentos" className="underline">Ver lançamentos</Link></>}
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 lg:grid-cols-1 gap-3">
        {[
          { t: "Resultado venda direta", v: resultadoDireto, sub: "o mesmo do card Resultado" },
          { t: "Lucro marketplace", v: data.marketplace.lucro, sub: `${data.marketplace.pedidos} pedidos · ${fmtBRL(data.marketplace.vendas)}` },
          { t: "Total", v: lucroTotal, sub: "direta + marketplace" },
        ].map(c => (
          <div key={c.t} className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40 mb-1">{c.t}</p>
            <p className={`text-lg font-black ${c.v === null ? "text-[#0F1E3C]/40" : c.v < 0 ? "text-red-600" : "text-emerald-600"}`}>{c.v === null ? "—" : fmtBRL(c.v)}</p>
            <p className="text-[10px] text-[#0F1E3C]/35 mt-0.5 truncate">{c.sub}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
