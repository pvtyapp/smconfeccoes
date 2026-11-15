"use client"

// Estoque > Mínimo e alvo (PIV 14/11): grade cor × tamanho com o MÍNIMO (chegou nele, avisa o
// grupo SM Administrativo pra produzir) e o ALVO (até quanto produzir). Atalhos pra não
// preencher 196 casas na mão: sugerir pelo giro (vendas dos últimos 30 dias), copiar uma cor
// pras outras e preencher a coluna inteira.
import { useEffect, useMemo, useState } from "react"
import { Loader2, Wand2, Copy, Save } from "lucide-react"
import { colorSwatch } from "@/lib/colorSwatch"

type V = { variantId: string; productId: string; productName: string; color: string; size: string; sizeIdx: number; minStock: number; targetStock: number; disponivel: number; vendas30: number }
type Edit = Record<string, { min: string; alvo: string }>

// PIV 15/11: números redondos de 10 em 10 (30, 40, 50...)
const arred10 = (n: number) => (n <= 0 ? 0 : Math.ceil(n / 10) * 10)
// A SM vende de segunda a sexta: o giro é por dia útil (seg–sex dos últimos 30 dias)
const DIAS_UTEIS_30 = (() => { let n = 0; for (let i = 0; i < 30; i++) { const d = new Date(Date.now() - i * 864e5).getDay(); if (d >= 1 && d <= 5) n++ } return n })()
const porDia = (v: { vendas30: number }) => v.vendas30 / DIAS_UTEIS_30

export default function MinimoAlvo() {
  const [vs, setVs] = useState<V[] | null>(null)
  const [erro, setErro] = useState("")
  const [prod, setProd] = useState("")
  const [ed, setEd] = useState<Edit>({})
  const [diasMin, setDiasMin] = useState("2")
  const [diasAlvo, setDiasAlvo] = useState("5")
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState("")

  async function carregar() {
    try {
      const r = await fetch("/api/estoque/minimos"); const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? "Erro")
      setVs(d.variantes); setEd({})
      setProd(p => p || (d.variantes[0]?.productName ?? ""))
    } catch (e) { setErro(e instanceof Error ? e.message : "Não consegui carregar") }
  }
  useEffect(() => { carregar() }, [])

  const produtos = useMemo(() => [...new Set((vs ?? []).map(v => v.productName))], [vs])
  const doProd = (vs ?? []).filter(v => v.productName === prod)
  const cores = [...new Set(doProd.map(v => v.color))]
  const tams = [...new Set([...doProd].sort((a, b) => a.sizeIdx - b.sizeIdx).map(v => v.size))]
  const cel = (c: string, t: string) => doProd.find(v => v.color === c && v.size === t)
  const val = (v: V) => ed[v.variantId] ?? { min: v.minStock ? String(v.minStock) : "", alvo: v.targetStock ? String(v.targetStock) : "" }
  const num = (s: string) => Math.max(0, parseInt(s.replace(/\D/g, ""), 10) || 0)
  const mudou = (vs ?? []).filter(v => ed[v.variantId] && (num(ed[v.variantId].min) !== v.minStock || num(ed[v.variantId].alvo) !== v.targetStock))
  const set = (v: V, campo: "min" | "alvo", s: string) => setEd(e => ({ ...e, [v.variantId]: { ...val(v), [campo]: s.replace(/\D/g, "") } }))

  function sugerir(lista: V[]) {
    const dm = Math.max(1, Number(diasMin) || 7), da = Math.max(dm, Number(diasAlvo) || 21)
    setEd(e => {
      const n = { ...e }
      for (const v of lista) {
        const dia = porDia(v)
        n[v.variantId] = { min: String(arred10(dia * dm)), alvo: String(arred10(dia * da)) }
      }
      return n
    })
    setMsg(`Sugestão preenchida pelo giro (mínimo = ${dm} dias úteis de venda, alvo = ${da} dias, de 10 em 10). Confere e salva.`)
  }
  function copiarCor(origem: string) {
    setEd(e => {
      const n = { ...e }
      for (const t of tams) {
        const o = cel(origem, t); if (!o) continue
        for (const c of cores) { const d = cel(c, t); if (d && c !== origem) n[d.variantId] = { ...val(o) } }
      }
      return n
    })
    setMsg(`Grade da cor ${origem} copiada pras outras cores. Confere e salva.`)
  }
  function preencherColuna(t: string, campo: "min" | "alvo") {
    const v0 = cores.map(c => cel(c, t)).find(Boolean); if (!v0) return
    const s = val(v0)[campo]
    setEd(e => { const n = { ...e }; for (const c of cores) { const d = cel(c, t); if (d) n[d.variantId] = { ...(n[d.variantId] ?? val(d)), [campo]: s } } return n })
  }

  async function salvar() {
    setSalvando(true); setMsg("")
    try {
      const itens = mudou.map(v => ({ variantId: v.variantId, minStock: num(ed[v.variantId].min), targetStock: num(ed[v.variantId].alvo) }))
      const r = await fetch("/api/estoque/minimos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itens }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? "Não consegui salvar")
      setMsg(`Salvo: ${d.salvos} ${d.salvos === 1 ? "item" : "itens"}. O aviso de produzir confere a cada 30 min (seg a sex, 8h às 18h).`)
      await carregar()
    } catch (e) { setMsg(e instanceof Error ? e.message : "Não consegui salvar") } finally { setSalvando(false) }
  }

  if (erro) return <p className="text-[#C62828] font-bold">{erro}</p>
  if (!vs) return <p className="flex items-center gap-2 text-[#6B7891]"><Loader2 className="animate-spin" size={16} /> Carregando…</p>

  const abaixo = vs.filter(v => { const e = ed[v.variantId]; const m = e ? num(e.min) : v.minStock; return m > 0 && v.disponivel <= m })
  const semMin = vs.filter(v => !(ed[v.variantId] ? num(ed[v.variantId].min) : v.minStock)).length
  const inp = "w-full min-w-0 h-8 rounded-lg border border-[#0F1E3C]/15 bg-white text-center text-sm font-extrabold tabular-nums outline-none focus:border-[#4361EE]"

  return (
    <div className="grid gap-4 text-[#0F1E3C]">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-[#E3E7EF] p-3.5"><small className="text-xs font-bold text-[#6B7891]">Abaixo do mínimo</small><b className="block text-2xl tabular-nums" style={{ fontFamily: "var(--font-anton)" }}>{abaixo.length}</b></div>
        <div className="bg-white rounded-2xl border border-[#E3E7EF] p-3.5"><small className="text-xs font-bold text-[#6B7891]">Sem mínimo definido</small><b className="block text-2xl tabular-nums" style={{ fontFamily: "var(--font-anton)" }}>{semMin} de {vs.length}</b></div>
        <div className="bg-white rounded-2xl border border-[#E3E7EF] p-3.5 col-span-2 md:col-span-1"><small className="text-xs font-bold text-[#6B7891]">Pra produzir (até o alvo)</small><b className="block text-2xl tabular-nums" style={{ fontFamily: "var(--font-anton)" }}>{abaixo.reduce((s, v) => { const e = ed[v.variantId]; const m = e ? num(e.min) : v.minStock, a = e ? num(e.alvo) : v.targetStock; return s + Math.max(0, Math.max(m, a) - v.disponivel) }, 0)} peças</b></div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {produtos.map(p => (
          <button key={p} onClick={() => setProd(p)} className={"rounded-full border px-3 py-1.5 text-[13px] font-bold " + (p === prod ? "bg-[#0F1E3C] text-white border-[#0F1E3C]" : "bg-white border-[#E3E7EF] text-[#6B7891]")}>{p}</button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-[#E3E7EF] p-4 grid gap-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="grid gap-1 text-xs font-bold text-[#6B7891]">Mínimo = dias úteis de venda<input id="dias-min" inputMode="numeric" value={diasMin} onChange={e => setDiasMin(e.target.value.replace(/\D/g, ""))} className="w-24 h-9 rounded-lg border border-[#E3E7EF] bg-[#EEF1F6] text-center font-bold" /></label>
          <label className="grid gap-1 text-xs font-bold text-[#6B7891]">Alvo = dias úteis de venda<input id="dias-alvo" inputMode="numeric" value={diasAlvo} onChange={e => setDiasAlvo(e.target.value.replace(/\D/g, ""))} className="w-24 h-9 rounded-lg border border-[#E3E7EF] bg-[#EEF1F6] text-center font-bold" /></label>
          <button onClick={() => sugerir(doProd)} className="flex items-center gap-1.5 h-9 rounded-xl bg-[#4361EE] text-white px-3 text-[13px] font-bold"><Wand2 size={14} />Sugerir pelo giro: {prod}</button>
          <button onClick={() => sugerir(vs)} className="flex items-center gap-1.5 h-9 rounded-xl border border-[#4361EE] text-[#4361EE] px-3 text-[13px] font-bold"><Wand2 size={14} />Sugerir em todos os produtos</button>
        </div>
        <p className="text-xs text-[#6B7891]">O giro usa as vendas dos últimos 30 dias de cada cor e tamanho (balcão, site, WhatsApp e marketplace; ajuste de estoque não conta), por dia útil, arredondado pra cima de 10 em 10. Item que não vendeu fica sem mínimo.</p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#E3E7EF]">
                <th className="px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wider text-[#6B7891]">Cor</th>
                {tams.map(t => (
                  <th key={t} className="px-2 py-2 text-[11px] font-extrabold uppercase tracking-wider text-[#6B7891] min-w-[92px]">
                    <span className="block text-[16px] text-[#0F1E3C]" style={{ fontFamily: "var(--font-anton)" }}>{t}</span>
                    <span className="flex justify-center gap-2 font-bold normal-case tracking-normal">
                      <button onClick={() => preencherColuna(t, "min")} title="Usar o mínimo da 1ª cor na coluna toda" className="text-[#4361EE]">mín ↓</button>
                      <button onClick={() => preencherColuna(t, "alvo")} title="Usar o alvo da 1ª cor na coluna toda" className="text-[#4361EE]">alvo ↓</button>
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {cores.map(c => (
                <tr key={c} className="border-b border-[#E3E7EF] last:border-0 align-top">
                  <td className="px-2 py-2 font-bold whitespace-nowrap"><span className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full border border-black/15" style={{ background: colorSwatch(c) }} />{c}</span></td>
                  {tams.map(t => {
                    const v = cel(c, t)
                    if (!v) return <td key={t} className="px-2 py-2 text-center text-[#6B7891]">–</td>
                    const x = val(v), m = num(x.min), baixo = m > 0 && v.disponivel <= m
                    return (
                      <td key={t} className={"px-1.5 py-1.5 " + (baixo ? "bg-[#FFF1F0]" : "")}>
                        <div className="grid grid-cols-2 gap-1">
                          <input id={`min-${v.variantId}`} aria-label={`Mínimo ${c} ${t}`} inputMode="numeric" placeholder="mín" value={x.min} onChange={e => set(v, "min", e.target.value)} className={inp} />
                          <input id={`alvo-${v.variantId}`} aria-label={`Alvo ${c} ${t}`} inputMode="numeric" placeholder="alvo" value={x.alvo} onChange={e => set(v, "alvo", e.target.value)} className={inp + " bg-[#EEF1F6]"} />
                        </div>
                        <small className={"block text-center text-[11px] mt-0.5 tabular-nums " + (baixo ? "text-[#C62828] font-bold" : "text-[#6B7891]")}>tem {v.disponivel} · vende {Math.round(porDia(v) * 10) / 10}/dia</small>
                      </td>
                    )
                  })}
                  <td className="px-2 py-2"><button onClick={() => copiarCor(c)} title={`Copiar a grade de ${c} pras outras cores`} className="flex items-center gap-1 text-[12px] font-bold text-[#4361EE] whitespace-nowrap"><Copy size={13} />copiar pras outras</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[#6B7891]">Em cada casa: <b>mínimo</b> (chegou nele, o grupo SM Administrativo recebe o aviso de produzir) e <b>alvo</b> (até quanto produzir). Vermelho = já está no mínimo ou abaixo. &quot;Tem&quot; = disponível de verdade, já tirando o que está em pedido aberto.</p>
      </div>

      {msg && <div className="rounded-xl bg-[#E8ECFD] px-3.5 py-3 text-sm font-bold">{msg}</div>}
      <div className="flex justify-end gap-2.5 sticky bottom-3">
        {mudou.length > 0 && <button onClick={() => { setEd({}); setMsg("") }} className="rounded-xl border border-[#E3E7EF] bg-white px-4 py-3 font-bold text-sm">Desfazer</button>}
        <button disabled={!mudou.length || salvando} onClick={salvar} className="flex items-center gap-2 rounded-xl bg-[#0F1E3C] text-white px-5 py-3 font-extrabold text-sm disabled:opacity-40">
          {salvando ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}Salvar {mudou.length ? `(${mudou.length})` : ""}
        </button>
      </div>
    </div>
  )
}
