"use client"

// Histórico de custo dos cortes (PIV 14/11): filtro de período, visão geral por produto aberta
// por tamanho, comparação com o período anterior, cartão por produto, gráfico corte a corte e
// planilha com o custo de cada tamanho. Média SEMPRE ponderada: soma do custo ÷ soma das peças.
// O custo de cada tamanho divide o custo da cor na proporção que o histórico achou (cortesCalc).
import { useEffect, useMemo, useState } from "react"
import { Loader2, Download } from "lucide-react"
import { colorSwatch } from "@/lib/colorSwatch"
import { todayBR } from "@/lib/tz"
import { calcularCorte, porTamanho, type CorCorte, type MalhaCorte, type Proporcao } from "@/lib/cortesCalc"

type Corte = { id: number; codigo: string; cortador: string; productName: string; sizes: string[]; cores: CorCorte[]; malha: MalhaCorte; createdAt: string }
type Linha = { cod: string; data: string; quem: string; prod: string; cor: string; grade: Record<string, number>; pecas: number; kg: number; preco: number; tecido: number; mao: number; custo: number }
type Agg = { pecas: number; kg: number; custo: number; pp: number; cortes: number; min: number; max: number }

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const n2 = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })
const tit = { fontFamily: "var(--font-anton), Impact, sans-serif" }
const dataSP = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })
const somaDias = (iso: string, d: number) => { const x = new Date(iso + "T12:00:00"); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10) }
const dBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const PERIODOS = [["mes", "Este mês"], ["mespass", "Mês passado"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["tudo", "Tudo"], ["datas", "Escolher datas"]] as const
type Per = typeof PERIODOS[number][0]

function Bola({ cor }: { cor: string }) {
  return <span className="inline-block w-3 h-3 rounded-full border border-black/15 flex-none" style={{ background: colorSwatch(cor) }} />
}

// soma um conjunto de linhas (mesmo produto); t = só a parte daquele tamanho
function agrega(xs: Linha[], t: string | null, props: Record<string, Proporcao>): Agg | null {
  let pecas = 0, kg = 0, custo = 0
  const porCorte: Record<string, { c: number; p: number }> = {}
  for (const h of xs) {
    let q = h.pecas, k = h.kg, c = h.custo
    if (t) {
      q = h.grade[t] || 0; if (!q) continue
      const w = props[h.prod]?.w ?? {}
      const S = Object.entries(h.grade).reduce((s, [x, v]) => s + v * (w[x] || 0), 0)
      const fr = S ? (q * (w[t] || 0)) / S : q / h.pecas
      k = h.kg * fr; c = h.tecido * fr + h.mao * q
    }
    pecas += q; kg += k; custo += c
    const pc = porCorte[h.cod] ??= { c: 0, p: 0 }; pc.c += c; pc.p += q
  }
  if (!pecas) return null
  const vs = Object.values(porCorte).filter(x => x.p).map(x => x.c / x.p)
  return { pecas, kg, custo, pp: custo / pecas, cortes: Object.keys(porCorte).length, min: Math.min(...vs), max: Math.max(...vs) }
}

export default function Historico() {
  const hoje = todayBR()
  const [per, setPer] = useState<Per>("90")
  const [deX, setDeX] = useState(somaDias(hoje, -29))
  const [ateX, setAteX] = useState(hoje)
  const [prod, setProd] = useState("")
  const [cor, setCor] = useState("")
  const [quem, setQuem] = useState("")
  const [ord, setOrd] = useState<{ k: string; dir: number }>({ k: "data", dir: -1 })
  const [dados, setDados] = useState<{ cortes: Corte[]; proporcoes: Record<string, Proporcao & { sizes: string[] }> } | null>(null)
  const [erro, setErro] = useState("")

  const [de, ate] = useMemo<[string, string]>(() => {
    if (per === "mes") return [hoje.slice(0, 8) + "01", hoje]
    if (per === "mespass") { const x = new Date(hoje.slice(0, 8) + "01T12:00:00"); x.setDate(0); const fim = x.toISOString().slice(0, 10); return [fim.slice(0, 8) + "01", fim] }
    if (per === "30") return [somaDias(hoje, -29), hoje]
    if (per === "90") return [somaDias(hoje, -89), hoje]
    if (per === "datas") return [deX <= ateX ? deX : ateX, deX <= ateX ? ateX : deX]
    return ["2026-01-01", hoje]
  }, [per, deX, ateX, hoje])
  const dias = Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 864e5) + 1
  const antDe = somaDias(de, -dias), antAte = somaDias(de, -1)

  useEffect(() => {
    let vivo = true
    setDados(null); setErro("")
    fetch(`/api/cortes/historico?de=${per === "tudo" ? de : antDe}&ate=${ate}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Erro"); if (vivo) setDados(d) })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : "Não consegui carregar o histórico") })
    return () => { vivo = false }
  }, [de, ate, antDe, per])

  const props = useMemo(() => dados?.proporcoes ?? {}, [dados])
  const todas: Linha[] = useMemo(() => (dados?.cortes ?? []).flatMap(k => {
    const ct = calcularCorte(k.cores, k.malha)
    return ct.linhas.map((l, i) => {
      const mao = k.malha.maoCorte || 0
      return { cod: k.codigo, data: dataSP(k.createdAt), quem: k.cortador, prod: k.productName, cor: l.cor, grade: k.cores[i].grade,
        pecas: l.pecas, kg: l.kg, preco: l.precoKg ?? 0, tecido: l.tecido ?? 0, mao, custo: (l.tecido ?? 0) + mao * l.pecas }
    })
  }), [dados])

  const noPer = todas.filter(h => h.data >= de && h.data <= ate && (!quem || h.quem === quem))
  const antes = per === "tudo" ? [] : todas.filter(h => h.data >= antDe && h.data <= antAte && (!quem || h.quem === quem))
  const L = noPer.filter(h => (!prod || h.prod === prod) && (!cor || h.cor === cor))
  const sizesDe = (p: string) => props[p]?.sizes ?? [...new Set(todas.filter(h => h.prod === p).flatMap(h => Object.keys(h.grade)))]
  const txtPer = per === "tudo" ? "desde o primeiro corte" : `${dBR(de)} a ${dBR(ate)}`
  const prodsG = [...new Set(noPer.map(h => h.prod))]
  const prodsL = [...new Set(L.map(h => h.prod))]

  const card = "bg-white rounded-2xl border border-[#E3E7EF]"
  const th = "px-2.5 py-2 text-[11px] font-extrabold uppercase tracking-wider text-[#6B7891] text-right whitespace-nowrap"
  const td = "px-2.5 py-2.5 text-right whitespace-nowrap tabular-nums"
  const varia = (a: Agg | null, b: Agg | null) => {
    if (!a || !b) return <span className="text-[#6B7891]">–</span>
    const d = ((a.pp - b.pp) / b.pp) * 100
    const c = Math.abs(d) < 1 ? "#6B7891" : d > 0 ? "#C62828" : "#00866A"
    return <span className="font-extrabold" style={{ color: c }}>{d > 0 ? "▲" : d < 0 ? "▼" : ""} {n2(Math.abs(d), 1)}%</span>
  }
  const linhaGeral = (rot: React.ReactNode, a: Agg, b: Agg | null, sub: boolean, key: string) => (
    <tr key={key} className={"border-b border-[#E3E7EF] " + (sub ? "" : "bg-[#F6F8FD]")}>
      <td className={td + " text-left"}>{rot}</td>
      <td className={td}>{sub ? "" : a.cortes}</td><td className={td}>{a.pecas.toLocaleString("pt-BR")}</td><td className={td}>{n2(a.kg, 1)}</td>
      <td className={td}>{n2(a.kg / a.pecas, 3)}</td><td className={td}>{brl(a.custo)}</td>
      <td className={td + (sub ? "" : " font-extrabold")}>{brl(a.pp)}</td>
      <td className={td + " text-[#6B7891]"}>{a.cortes > 1 ? `${n2(a.min)} a ${n2(a.max)}` : "–"}</td><td className={td}>{varia(a, b)}</td>
    </tr>
  )

  // planilha
  const tamsL = [...new Set(prodsL.flatMap(sizesDe))]
  const rows = L.map(h => ({ ...h, pp: h.custo / h.pecas, pt: porTamanho(h.grade, h.tecido, props[h.prod]?.w ?? Object.fromEntries(Object.keys(h.grade).map(t => [t, 1]))) }))
  const valOrd = (r: typeof rows[number], k: string): number | string => k.startsWith("t_") ? (r.pt[k.slice(2)] ?? -1) : (r as unknown as Record<string, number | string>)[k]
  rows.sort((a, b) => { const x = valOrd(a, ord.k), y = valOrd(b, ord.k); return (x < y ? -1 : x > y ? 1 : 0) * ord.dir })
  const cols: [string, string][] = [["data", "Data"], ["cod", "Corte"], ["quem", "Cortador"], ["prod", "Produto"], ["cor", "Cor"], ["pecas", "Peças"], ["kg", "Kg"], ["preco", "R$/kg"], ["custo", "Custo"], ["pp", "Média"], ...tamsL.map(t => ["t_" + t, t] as [string, string])]
  const clicaOrd = (k: string) => setOrd(o => o.k === k ? { k, dir: -o.dir } : { k, dir: k === "data" ? -1 : 1 })

  function baixar() {
    const sep = ";"
    const esc = (v: string) => /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const num = (v: number, d = 2) => v.toFixed(d).replace(".", ",")
    const linhas = [cols.map(c => c[1]).join(sep), ...rows.map(r => [dBR(r.data), r.cod, esc(r.quem), esc(r.prod), esc(r.cor), String(r.pecas), num(r.kg, 1), num(r.preco), num(r.custo), num(r.pp),
      ...tamsL.map(t => r.pt[t] != null ? num(r.pt[t] + r.mao) : "")].join(sep))]
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `cortes_${de}_a_${ate}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  // gráfico do produto escolhido (ou do primeiro)
  const pg = prod || prodsL[0]
  const pontos = [...new Set(L.filter(h => h.prod === pg).map(h => h.cod))].map(c => {
    const ys = L.filter(h => h.prod === pg && h.cod === c); const pc = ys.reduce((s, h) => s + h.pecas, 0)
    return { c, data: ys[0].data, pc, v: ys.reduce((s, h) => s + h.custo, 0) / pc }
  }).sort((a, b) => (a.data < b.data ? -1 : 1))

  return (
    <div className="grid gap-4 min-w-0">
      <div className={card + " p-4 grid gap-3"}>
        <div className="flex flex-wrap gap-1.5">
          {PERIODOS.map(([k, l]) => (
            <button key={k} onClick={() => setPer(k)} className={"rounded-full border px-3 py-1.5 text-[13px] font-bold " + (per === k ? "bg-[#4361EE] border-[#4361EE] text-white" : "bg-[#EEF1F6] border-[#E3E7EF]")}>{l}</button>
          ))}
        </div>
        {per === "datas" && (
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1 text-xs font-bold text-[#6B7891]">De<input type="date" value={deX} onChange={e => setDeX(e.target.value)} className="h-10 rounded-xl border border-[#E3E7EF] bg-[#EEF1F6] px-2.5 font-bold text-sm text-[#0F1E3C]" /></label>
            <label className="grid gap-1 text-xs font-bold text-[#6B7891]">Até<input type="date" value={ateX} onChange={e => setAteX(e.target.value)} className="h-10 rounded-xl border border-[#E3E7EF] bg-[#EEF1F6] px-2.5 font-bold text-sm text-[#0F1E3C]" /></label>
          </div>
        )}
        <div className="grid gap-2.5 sm:grid-cols-3">
          {[["Produto", prod, (v: string) => { setProd(v); setCor("") }, [...new Set(todas.map(h => h.prod))], "Todos os produtos"],
            ["Cor", cor, setCor, [...new Set(todas.filter(h => !prod || h.prod === prod).map(h => h.cor))], "Todas as cores"],
            ["Cortador", quem, setQuem, [...new Set(todas.map(h => h.quem))], "Todos"]].map(([lab, val, set, lista, todos]) => (
            <label key={lab as string} className="grid gap-1 text-xs font-bold text-[#6B7891]">{lab as string}
              <select value={val as string} onChange={e => (set as (v: string) => void)(e.target.value)} className="h-10 rounded-xl border border-[#E3E7EF] bg-[#EEF1F6] px-2.5 font-bold text-sm text-[#0F1E3C]">
                <option value="">{todos as string}</option>
                {(lista as string[]).map(x => <option key={x}>{x}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      {erro && <p className="text-[#C62828] font-bold">{erro}</p>}
      {!dados && !erro && <p className="flex items-center gap-2 text-[#6B7891]"><Loader2 className="animate-spin" size={16} /> Carregando…</p>}

      {dados && (<>
        {/* visão geral */}
        <div className={card + " p-4 grid gap-3 min-w-0"}>
          <div className="flex flex-wrap justify-between gap-2 items-baseline">
            <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[#6B7891]">Visão geral · {txtPer}</h3>
            {per !== "tudo" && <span className="text-xs text-[#6B7891]">Comparação com os {dias} dias antes ({dBR(antDe)} a {dBR(antAte)})</span>}
          </div>
          {prodsG.length === 0 ? <p className="text-sm text-[#6B7891]">Nenhum corte aprovado nesse período.</p> : (<>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="border-b border-[#E3E7EF]"><th className={th + " text-left"}>Produto / tamanho</th><th className={th}>Cortes</th><th className={th}>Peças</th><th className={th}>Kg</th><th className={th}>Kg/peça</th><th className={th}>Custo</th><th className={th}>Custo médio/peça</th><th className={th}>Faixa por corte</th><th className={th}>vs. antes</th></tr></thead>
                <tbody>
                  {prodsG.map(p => {
                    const xs = noPer.filter(h => h.prod === p), xa = antes.filter(h => h.prod === p)
                    const a = agrega(xs, null, props)!
                    return [linhaGeral(<b>{p}</b>, a, agrega(xa, null, props), false, p),
                      ...sizesDe(p).map(t => { const at = agrega(xs, t, props); return at ? linhaGeral(<span className="pl-5 text-[17px]" style={tit}>{t}</span>, at, agrega(xa, t, props), true, p + t) : null })]
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[#6B7891]">▲ vermelho = a peça ficou mais cara que no período anterior · ▼ verde = mais barata. Custo médio = custo ÷ peças do período. Cada tamanho usa a proporção achada no histórico (no cartão de cada produto).</p>
          </>)}
        </div>

        {/* cartões */}
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
          {prodsL.length === 0 ? <div className={card + " p-4 text-sm text-[#6B7891]"}>Nenhum corte aprovado nesse período com esses filtros.</div> : prodsL.map(p => {
            const xs = L.filter(h => h.prod === p), a = agrega(xs, null, props)!, pr = props[p], tams = sizesDe(p)
            return (
              <div key={p} className={card + " p-4 grid gap-2.5 min-w-0"}>
                <div className="flex justify-between gap-2 items-baseline"><b>{p}</b><small className="text-[#6B7891] font-bold">{a.cortes} corte{a.cortes > 1 ? "s" : ""}</small></div>
                <div className="text-[38px] leading-none tabular-nums" style={tit}>{brl(a.pp)}<small className="text-[13px] font-bold text-[#6B7891] ml-1.5" style={{ fontFamily: "inherit" }}>por peça, média da grade</small></div>
                <div className="rounded-xl bg-[#E8ECFD] px-3 py-2 text-[13px] tabular-nums">{brl(a.custo)} ÷ {a.pecas.toLocaleString("pt-BR")} peças = <b>{brl(a.pp)}</b></div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(62px, 1fr))" }}>
                  {tams.map(t => { const at = agrega(xs, t, props); return (
                    <div key={t} className="rounded-xl bg-[#EEF1F6] py-2 px-1 grid justify-items-center">
                      <span className="text-[18px] leading-none" style={tit}>{t}</span>
                      <b className="text-sm tabular-nums">{at ? brl(at.pp) : "–"}</b>
                      <small className="text-[11px] text-[#6B7891] tabular-nums">{at ? `${at.pecas} pç` : "sem corte"}</small>
                    </div>) })}
                </div>
                <p className="text-[12.5px] text-[#6B7891] leading-snug">
                  {pr?.ok
                    ? <>📐 Proporção usada, ajustada com <b className="text-[#0F1E3C]">{pr.n} cortes</b> dos últimos 6 meses (parte de ~9% a mais por tamanho): {tams.map(t => `${t} ${n2((pr.w[t] ?? 0) * 1000, 0)} g`).join(" · ")} de malha por peça.</>
                    : <>📐 Com <b className="text-[#0F1E3C]">{pr?.n ?? 0} corte{(pr?.n ?? 0) === 1 ? "" : "s"}</b> ainda não dá pra separar por tamanho: precisa de pelo menos 3 com grades diferentes. Até lá todos ficam com a média.</>}
                </p>
                <div className="grid grid-cols-3 gap-2 text-[12px]">
                  <div className="grid"><small className="text-[#6B7891] font-bold">Kg por peça</small><b className="text-sm tabular-nums">{n2(a.kg / a.pecas, 3)}</b></div>
                  <div className="grid"><small className="text-[#6B7891] font-bold">R$/kg médio</small><b className="text-sm tabular-nums">{n2(xs.reduce((s, h) => s + h.tecido, 0) / a.kg)}</b></div>
                  <div className="grid"><small className="text-[#6B7891] font-bold">Faixa por corte</small><b className="text-sm tabular-nums">{a.cortes > 1 ? `${n2(a.min)}–${n2(a.max)}` : "–"}</b></div>
                </div>
              </div>
            )
          })}
        </div>

        {/* gráfico */}
        <div className={card + " p-4 grid gap-2 min-w-0"}>
          <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[#6B7891]">Custo por peça, corte a corte{pg ? ` · ${pg}` : ""}</h3>
          {pontos.length < 2 ? <p className="text-sm text-[#6B7891]">{pg ? `Com ${pontos.length} corte de ${pg} no período ainda não dá pra comparar.` : "Escolha um produto."}</p> : (() => {
            const W = 760, H = 240, ml = 58, mr = 16, mt = 16, mb = 34
            const media = pontos.reduce((s, x) => s + x.v * x.pc, 0) / pontos.reduce((s, x) => s + x.pc, 0)
            let lo = Math.min(...pontos.map(x => x.v), media), hi = Math.max(...pontos.map(x => x.v), media)
            const pad = (hi - lo) * 0.25 || 0.5; lo = Math.max(0, lo - pad); hi = hi + pad
            const ticks = [0, 1, 2, 3, 4].map(i => lo + ((hi - lo) / 4) * i)
            const X = (i: number) => ml + ((W - ml - mr) * i) / (pontos.length - 1), Y = (v: number) => mt + (H - mt - mb) * (1 - (v - lo) / (hi - lo))
            const maxPc = Math.max(...pontos.map(x => x.pc))
            return (<>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Custo por peça de cada corte">
                {ticks.map((t, i) => <g key={i}><line x1={ml} x2={W - mr} y1={Y(t)} y2={Y(t)} stroke="#E3E7EF" /><text x={ml - 8} y={Y(t) + 4} textAnchor="end" fontSize="11" fill="#6B7891">{n2(t)}</text></g>)}
                <polyline fill="none" stroke="#4361EE" strokeWidth="2" points={pontos.map((x, i) => `${X(i)},${Y(x.v)}`).join(" ")} />
                <line x1={ml} x2={W - mr} y1={Y(media)} y2={Y(media)} stroke="#C77700" strokeWidth="2" strokeDasharray="6 5" />
                {pontos.map((x, i) => <g key={x.c}>
                  <circle cx={X(i)} cy={Y(x.v)} r={4 + 8 * Math.sqrt(x.pc / maxPc)} fill="#4361EE" fillOpacity=".85" stroke="#fff" strokeWidth="2"><title>{`${x.c} · ${dBR(x.data)} · ${x.pc} peças · ${brl(x.v)}`}</title></circle>
                  <text x={X(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="#6B7891">{dBR(x.data)}</text>
                </g>)}
              </svg>
              <div className="flex flex-wrap gap-4 text-[12.5px] text-[#6B7891]">
                <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#4361EE] mr-1.5 align-middle" />cada corte, média da grade (bolinha maior = mais peças)</span>
                <span><span className="inline-block w-4 border-t-2 border-dashed border-[#C77700] mr-1.5 align-middle" />média do período: {brl(media)}</span>
              </div>
            </>)
          })()}
        </div>

        {/* planilha */}
        <div className={card + " p-4 grid gap-3 min-w-0"}>
          <div className="flex flex-wrap justify-between items-center gap-2">
            <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[#6B7891]">Planilha dos cortes</h3>
            <button onClick={baixar} disabled={!rows.length} className="flex items-center gap-1.5 rounded-xl border border-[#E3E7EF] bg-white px-3 py-2 text-[13px] font-bold disabled:opacity-40"><Download size={14} />Baixar planilha (Excel)</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead><tr className="border-b border-[#E3E7EF]">{cols.map(([k, l], i) => (
                <th key={k} onClick={() => clicaOrd(k)} className={th + " cursor-pointer select-none hover:text-[#0F1E3C]" + (i < 5 ? " text-left" : "")}>{l}{ord.k === k ? (ord.dir > 0 ? " ▲" : " ▼") : ""}</th>))}</tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={r.cod + r.cor + i} className="border-b border-[#E3E7EF] last:border-0">
                  <td className={td + " text-left"}>{dBR(r.data)}</td><td className={td + " text-left"}>{r.cod}</td><td className={td + " text-left"}>{r.quem}</td><td className={td + " text-left"}>{r.prod}</td>
                  <td className={td + " text-left"}><span className="flex items-center gap-2"><Bola cor={r.cor} />{r.cor}</span></td>
                  <td className={td}>{r.pecas}</td><td className={td}>{n2(r.kg, 1)}</td><td className={td}>{n2(r.preco)}</td><td className={td}>{brl(r.custo)}</td><td className={td + " font-extrabold"}>{brl(r.pp)}</td>
                  {tamsL.map(t => <td key={t} className={td}>{r.pt[t] != null ? <>{n2(r.pt[t] + r.mao)}<small className="block text-[11px] text-[#6B7891]">{r.grade[t]} pç</small></> : <span className="text-[#6B7891]">–</span>}</td>)}
                </tr>))}</tbody>
              {rows.length > 0 && prodsL.length === 1 && (() => { const a = agrega(L, null, props)!; return (
                <tfoot><tr className="border-t-2 border-[#E3E7EF] font-extrabold">
                  <td className={td + " text-left"} colSpan={5}>Total do período (média ponderada)</td><td className={td}>{a.pecas}</td><td className={td}>{n2(a.kg, 1)}</td>
                  <td className={td}>{n2(L.reduce((s, h) => s + h.tecido, 0) / a.kg)}</td><td className={td}>{brl(a.custo)}</td><td className={td}>{brl(a.pp)}</td>
                  {tamsL.map(t => { const at = agrega(L, t, props); return <td key={t} className={td}>{at ? n2(at.pp) : "–"}</td> })}
                </tr></tfoot>) })()}
            </table>
          </div>
        </div>
      </>)}
    </div>
  )
}
