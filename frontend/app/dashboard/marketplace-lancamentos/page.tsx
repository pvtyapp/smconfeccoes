"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Bot, Hand, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react"
import { todayBR, subDaysBR } from "@/lib/tz"
import {
  LOJAS_MKT, MKT_INICIO, PLATAFORMA_MKT, plataformaDaLoja, diasEntre, ddmm, fmtBRL, lucroDe,
  type FechamentoMkt, type RegraCusto,
} from "@/lib/mktFechamento"

// Lançamentos do marketplace: 1 linha por dia + loja. O agente do outro PC lança pela API;
// aqui corrige à mão (clica na célula, edita, sai do campo e salva).

type Linha = FechamentoMkt & { avisos: string[] }
type Aba = "grade" | "custos" | "como"

const cellBase = "w-full bg-transparent border border-transparent hover:border-[#0F1E3C]/12 focus:border-[#4361EE]/40 rounded-lg px-1.5 py-1 text-xs text-[#0F1E3C] focus:outline-none focus:bg-white"
const cellCls = `${cellBase} text-right tabular-nums`
const cellTxt = `${cellBase} text-left`
const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
const num = (n: number | null) => (n === null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

function Dot({ loja }: { loja: string }) {
  const p = PLATAFORMA_MKT[plataformaDaLoja(loja)]
  return <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: p.cor }} title={p.nome} />
}

export default function LancamentosPage() {
  const [aba, setAba] = useState<Aba>("grade")
  return (
    <div className="max-w-[1500px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Lançamentos do Marketplace</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5 max-w-2xl">
            Fechamento de cada dia da SHP MARI, SHP SAMU e TKTK SAMU. O robô do outro PC lança; aqui dá pra conferir e corrigir.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1E3C]/5 border border-[#0F1E3C]/8">
          {([["grade", "Lançamentos"], ["custos", "Custos"], ["como", "Como lançar"]] as [Aba, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${aba === k ? "bg-[#4361EE] text-white shadow-sm" : "text-[#0F1E3C]/50 hover:text-[#0F1E3C] hover:bg-white/60"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {aba === "grade" && <Grade />}
      {aba === "custos" && <Custos />}
      {aba === "como" && <ComoLancar />}
    </div>
  )
}

// ─── Grade ────────────────────────────────────────────────────────────────────

const COLUNAS: { k: keyof FechamentoMkt; label: string; inteiro?: boolean; vazio?: boolean }[] = [
  { k: "pedidos", label: "Pedidos", inteiro: true },
  { k: "pedidosUpseller", label: "Upseller", inteiro: true, vazio: true },
  { k: "pecas", label: "Peças", inteiro: true },
  { k: "vendas", label: "Vendas" },
  { k: "taxas", label: "Taxas" },
  { k: "cupom", label: "Cupom" },
  { k: "frete", label: "Frete" },
  { k: "ads", label: "Ads" },
  { k: "custo", label: "Custo", vazio: true },
  { k: "repasse", label: "Repasse", vazio: true },
]

function Grade() {
  const [de, setDe] = useState(() => { const d = subDaysBR(14); return d < MKT_INICIO ? MKT_INICIO : d })
  const [ate, setAte] = useState(() => subDaysBR(1))
  const [loja, setLoja] = useState("")
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState("")
  const [criando, setCriando] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/marketplace/fechamento?from=${de}&to=${ate}`, { cache: "no-store" })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "erro ao carregar")
      setLinhas(j); setErro("")
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [de, ate])
  useEffect(() => { carregar() }, [carregar])

  // grade completa: todo dia × loja do período, com os que faltam vazios
  const grade = useMemo(() => {
    const por = new Map(linhas.map(l => [`${l.dia}|${l.loja}`, l]))
    const lojas = loja ? [loja] : [...LOJAS_MKT]
    const out: { dia: string; loja: string; f: Linha | null }[] = []
    for (const d of diasEntre(de, ate).reverse()) for (const l of lojas) out.push({ dia: d, loja: l, f: por.get(`${d}|${l}`) ?? null })
    return out
  }, [linhas, de, ate, loja])

  const faltando = grade.filter(g => !g.f && g.dia >= MKT_INICIO && g.dia < todayBR()).length
  const comAviso = grade.filter(g => g.f && g.f.avisos.length > 0).length

  async function salvar(f: Linha, campo: keyof FechamentoMkt, texto: string) {
    const atual = f[campo] as number | null
    const novo = texto.trim() === "" ? null : Number(texto.replace(/\./g, "").replace(",", "."))
    if (novo !== null && Number.isNaN(novo)) { alert("Valor inválido"); return }
    if (novo === atual) return
    try {
      const r = await fetch(`/api/marketplace/fechamento/${f.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [campo]: novo }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "erro ao salvar")
      setLinhas(ls => ls.map(x => (x.id === f.id ? j.fechamento : x)))
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); carregar() }
  }

  async function salvarObs(f: Linha, texto: string) {
    if ((f.observacao ?? "") === texto.trim()) return
    const r = await fetch(`/api/marketplace/fechamento/${f.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observacao: texto }),
    })
    const j = await r.json()
    if (!r.ok) { alert(j.error || "erro ao salvar"); return }
    setLinhas(ls => ls.map(x => (x.id === f.id ? j.fechamento : x)))
  }

  async function criar(dia: string, l: string) {
    setCriando(`${dia}|${l}`)
    try {
      const r = await fetch("/api/marketplace/fechamento", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dia, loja: l, pedidos: 0, vendas: 0, origem: "manual" }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "erro ao criar")
      await carregar()
    } catch (e) { alert(e instanceof Error ? e.message : String(e)) }
    finally { setCriando(null) }
  }

  async function apagar(f: Linha) {
    if (!confirm(`Apagar o lançamento de ${ddmm(f.dia)} da ${f.loja}? Os itens desse dia também saem. O robô pode lançar de novo.`)) return
    const r = await fetch(`/api/marketplace/fechamento/${f.id}`, { method: "DELETE" })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { alert(j.error || "erro ao apagar"); return }
    setLinhas(ls => ls.filter(x => x.id !== f.id))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={de} onChange={e => setDe(e.target.value)} className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C]" />
        <span className="text-xs text-[#0F1E3C]/40">até</span>
        <input type="date" value={ate} onChange={e => setAte(e.target.value)} className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C]" />
        <select value={loja} onChange={e => setLoja(e.target.value)} className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C] bg-white">
          <option value="">Todas as lojas</option>
          {LOJAS_MKT.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={carregar} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs text-[#0F1E3C]/60 hover:text-[#0F1E3C] bg-white">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Atualizar
        </button>
        <span className="text-xs text-[#0F1E3C]/40 ml-auto">
          {faltando > 0 && <span className="text-amber-600 font-semibold">{faltando} sem lançamento</span>}
          {faltando > 0 && comAviso > 0 && " · "}
          {comAviso > 0 && <span className="text-amber-600 font-semibold">{comAviso} com aviso</span>}
        </span>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-x-auto">
        <table className="w-full text-xs min-w-[1100px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#0F1E3C]/40 text-left border-b border-[#0F1E3C]/8">
              <th className="px-3 py-2.5 font-semibold">Dia</th>
              <th className="px-2 py-2.5 font-semibold">Loja</th>
              {COLUNAS.map(c => <th key={c.k} className="px-1.5 py-2.5 font-semibold text-right">{c.label}</th>)}
              <th className="px-2 py-2.5 font-semibold text-right">Lucro</th>
              <th className="px-2 py-2.5 font-semibold">Obs.</th>
              <th className="px-2 py-2.5 font-semibold">Quem</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {grade.map(({ dia, loja: l, f }) => {
              if (!f) {
                const cobrado = dia >= MKT_INICIO && dia < todayBR()
                return (
                  <tr key={`${dia}|${l}`} className={`border-t border-[#0F1E3C]/5 ${cobrado ? "bg-amber-50/40" : ""}`}>
                    <td className="px-3 py-2 text-[#0F1E3C]/60 whitespace-nowrap">{ddmm(dia)}</td>
                    <td className="px-2 py-2 whitespace-nowrap"><span className="flex items-center gap-1.5 text-[#0F1E3C]/60"><Dot loja={l} />{l}</span></td>
                    <td colSpan={COLUNAS.length + 3} className="px-2 py-2 text-[#0F1E3C]/35">
                      {cobrado ? "sem lançamento" : dia >= todayBR() ? "o dia ainda não fechou" : "antes de 01/10"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => criar(dia, l)} disabled={criando !== null}
                        className="flex items-center gap-1 text-[11px] font-semibold text-[#4361EE] hover:underline disabled:opacity-40 ml-auto whitespace-nowrap">
                        {criando === `${dia}|${l}` ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} lançar à mão
                      </button>
                    </td>
                  </tr>
                )
              }
              const lucro = lucroDe(f)
              return (
                <tr key={f.id} className={`border-t border-[#0F1E3C]/5 ${f.avisos.length ? "bg-amber-50/30" : ""}`}>
                  <td className="px-3 py-1.5 text-[#0F1E3C] font-semibold whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      {ddmm(f.dia)}
                      {f.avisos.length > 0 && (
                        <span title={f.avisos.join("\n")} className="text-amber-500 cursor-help"><AlertTriangle size={12} /></span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap"><span className="flex items-center gap-1.5 text-[#0F1E3C]"><Dot loja={f.loja} />{f.loja}</span></td>
                  {COLUNAS.map(c => {
                    const v = f[c.k] as number | null
                    const destaque = (c.k === "pedidosUpseller" && v !== null && v !== f.pedidos) || (c.k === "custo" && (v === null || f.itensSemCusto > 0))
                    return (
                      <td key={c.k} className="px-0.5 py-1 min-w-[64px]">
                        <input key={`${f.id}-${c.k}-${v}`} defaultValue={c.inteiro ? (v ?? "").toString() : num(v)} inputMode="decimal"
                          placeholder={c.vazio ? "—" : "0"}
                          onBlur={e => salvar(f, c.k, e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                          className={`${cellCls} ${destaque ? "text-amber-600 font-semibold" : ""}`} />
                      </td>
                    )
                  })}
                  <td className={`px-2 py-1.5 text-right font-bold tabular-nums whitespace-nowrap ${lucro < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtBRL(lucro)}</td>
                  <td className="px-0.5 py-1 min-w-[110px]">
                    <input key={`${f.id}-obs-${f.observacao}`} defaultValue={f.observacao ?? ""} placeholder="—"
                      onBlur={e => salvarObs(f, e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                      className={cellTxt} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-[10px] text-[#0F1E3C]/45" title={new Date(f.updatedAt).toLocaleString("pt-BR")}>
                    <span className="flex items-center gap-1">
                      {f.origem === "robo" ? <Bot size={11} /> : <Hand size={11} />}
                      {f.origem === "robo" ? "robô" : "à mão"}{f.atualizadoPor ? ` · ${f.atualizadoPor.split(" ")[0]}` : ""}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => apagar(f)} title="Apagar lançamento" className="text-[#0F1E3C]/25 hover:text-red-500"><Trash2 size={13} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[#0F1E3C]/40 leading-relaxed">
        Lucro = vendas − taxas − cupom − frete − Ads − custo. Clique numa célula, mude e aperte Enter (ou saia do campo) pra salvar.
        O ⚠️ mostra o que não bateu ao passar o mouse. &quot;Upseller&quot; é a quantidade de pedidos que o Upseller mostrou no dia (conferência);
        &quot;Repasse&quot; é o que a plataforma diz que vai pagar. Se o robô lançar o mesmo dia de novo, ele substitui o que está aqui.
      </p>
    </div>
  )
}

// ─── Custos ───────────────────────────────────────────────────────────────────

type Produto = { id: string; name: string; materialCost: number | null }
type SemCusto = { sku: string | null; titulo: string | null; qtd: number; lojas: number; ultimoDia: string }

function Custos() {
  const [regras, setRegras] = useState<RegraCusto[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [semCusto, setSemCusto] = useState<SemCusto[]>([])
  const [loading, setLoading] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [nova, setNova] = useState<{ prefixo: string; nome: string; produtos: string[]; extra: string } | null>(null)

  const carregar = useCallback(async () => {
    const r = await fetch("/api/marketplace/custos", { cache: "no-store" })
    const j = await r.json()
    if (r.ok) { setRegras(j.regras); setProdutos(j.produtos); setSemCusto(j.semCusto) }
    else alert(j.error || "erro ao carregar")
    setLoading(false)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const nomeProduto = (id: string) => produtos.find(p => p.id === id)?.name ?? "(produto apagado)"

  async function enviar(url: string, method: string, body: unknown) {
    setOcupado(true)
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "erro ao salvar")
      await carregar()
      return true
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); return false }
    finally { setOcupado(false) }
  }

  const sugerirPrefixo = (sku: string | null) => {
    if (!sku) return ""
    const m = sku.match(/^(kit-inf-|[a-z]+[_-])/i)
    return m ? m[1] : sku
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-[#0F1E3C]">Custo por tipo de peça</h2>
            <p className="text-xs text-[#0F1E3C]/45 mt-0.5 max-w-2xl">
              O SKU vendido que começar com o prefixo usa a soma do custo dos produtos escolhidos (o mesmo custo do cadastro de produtos) mais o extra.
              Se dois prefixos servirem, vale o mais comprido. Mudou o custo no cadastro de produtos? Clique em Recalcular.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => enviar("/api/marketplace/custos", "POST", { acao: "recalcular" })} disabled={ocupado}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#0F1E3C]/12 text-xs font-semibold text-[#0F1E3C]/70 hover:text-[#0F1E3C] disabled:opacity-40">
              <RefreshCw size={12} className={ocupado ? "animate-spin" : ""} /> Recalcular
            </button>
            <button onClick={() => setNova({ prefixo: "", nome: "", produtos: [], extra: "0" })}
              className="flex items-center gap-1.5 bg-[#0F1E3C] text-white text-xs font-semibold rounded-xl px-3 py-2 hover:bg-[#0F1E3C]/90">
              <Plus size={13} /> Nova regra
            </button>
          </div>
        </div>

        {loading ? <p className="text-xs text-[#0F1E3C]/40">Carregando...</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[#0F1E3C]/40 text-left">
                  <th className="py-2 pr-3 font-semibold">Prefixo do SKU</th>
                  <th className="py-2 pr-3 font-semibold">Nome</th>
                  <th className="py-2 pr-3 font-semibold">Produtos somados</th>
                  <th className="py-2 pr-3 font-semibold text-right">Extra</th>
                  <th className="py-2 pr-3 font-semibold text-right">Custo por peça</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {regras.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-[#0F1E3C]/35">Nenhuma regra ainda.</td></tr>}
                {regras.map(r => (
                  <tr key={r.id} className="border-t border-[#0F1E3C]/5 align-top">
                    <td className="py-1.5 pr-3 w-[150px]">
                      <input key={`p${r.id}${r.prefixo}`} defaultValue={r.prefixo} onBlur={e => e.target.value.trim() !== r.prefixo && enviar(`/api/marketplace/custos/${r.id}`, "PUT", { prefixo: e.target.value })}
                        className={`${cellTxt} font-mono`} />
                    </td>
                    <td className="py-1.5 pr-3 w-[180px]">
                      <input key={`n${r.id}${r.nome}`} defaultValue={r.nome} onBlur={e => e.target.value.trim() !== r.nome && enviar(`/api/marketplace/custos/${r.id}`, "PUT", { nome: e.target.value })}
                        className={cellTxt} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {r.produtos.map(id => (
                          <span key={id} className="flex items-center gap-1 bg-[#4361EE]/8 text-[#4361EE] rounded-md px-2 py-0.5">
                            {nomeProduto(id)}
                            <button onClick={() => enviar(`/api/marketplace/custos/${r.id}`, "PUT", { produtos: r.produtos.filter(x => x !== id) })} className="hover:text-red-500"><X size={10} /></button>
                          </span>
                        ))}
                        <select value="" onChange={e => e.target.value && enviar(`/api/marketplace/custos/${r.id}`, "PUT", { produtos: [...r.produtos, e.target.value] })}
                          className="w-[110px] text-[11px] text-[#0F1E3C]/50 bg-transparent border border-dashed border-[#0F1E3C]/15 rounded-md px-1 py-0.5">
                          <option value="">+ produto</option>
                          {produtos.map(p => <option key={p.id} value={p.id}>{p.name}{p.materialCost !== null ? ` (${fmtBRL(p.materialCost)})` : " (sem custo)"}</option>)}
                        </select>
                        {r.produtosSemCusto > 0 && <span className="text-amber-600" title="Produto sem custo no cadastro"><AlertTriangle size={11} /></span>}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 w-[90px]">
                      <input key={`e${r.id}${r.extra}`} defaultValue={num(r.extra)} inputMode="decimal"
                        onBlur={e => { const v = e.target.value.replace(/\./g, "").replace(",", "."); if (Number(v) !== r.extra) enviar(`/api/marketplace/custos/${r.id}`, "PUT", { extra: v }) }}
                        className={cellCls} />
                    </td>
                    <td className="py-1.5 pr-3 text-right font-bold text-[#0F1E3C] tabular-nums">{fmtBRL(r.custoUnitario)}</td>
                    <td className="py-1.5 text-right">
                      <button onClick={() => confirm(`Apagar a regra ${r.prefixo}? Os itens dela ficam sem custo.`) && enviar(`/api/marketplace/custos/${r.id}`, "DELETE", undefined)}
                        className="text-[#0F1E3C]/25 hover:text-red-500"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-bold text-[#0F1E3C]">Vendidos sem custo</h2>
        <p className="text-xs text-[#0F1E3C]/45">SKUs lançados que não caem em nenhuma regra. Esses itens entram com custo zero até ganhar uma regra.</p>
        {semCusto.length === 0 ? <p className="text-xs text-emerald-600 font-semibold">Tudo com custo.</p> : (
          <div className="divide-y divide-[#0F1E3C]/5">
            {semCusto.map(s => (
              <div key={s.sku ?? "(sem sku)"} className="flex items-center gap-3 py-2 text-xs">
                <span className="font-mono text-[#0F1E3C] min-w-0 truncate">{s.sku ?? "(sem SKU)"}</span>
                <span className="text-[#0F1E3C]/45 truncate flex-1 min-w-0">{s.titulo}</span>
                <span className="text-[#0F1E3C]/45 whitespace-nowrap">{s.qtd} un · último {ddmm(s.ultimoDia)}</span>
                <button onClick={() => setNova({ prefixo: sugerirPrefixo(s.sku), nome: "", produtos: [], extra: "0" })}
                  className="text-[11px] font-semibold text-[#4361EE] hover:underline whitespace-nowrap">criar regra</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {nova && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setNova(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[#0F1E3C]">Nova regra de custo</h3>
              <button onClick={() => setNova(null)} className="text-[#0F1E3C]/40 hover:text-[#0F1E3C]"><X size={16} /></button>
            </div>
            <label className="block text-xs text-[#0F1E3C]/60">Prefixo do SKU
              <input value={nova.prefixo} onChange={e => setNova({ ...nova, prefixo: e.target.value })} className={`${inputCls} mt-1 font-mono`} placeholder="ex.: kit-inf-" />
            </label>
            <label className="block text-xs text-[#0F1E3C]/60">Nome
              <input value={nova.nome} onChange={e => setNova({ ...nova, nome: e.target.value })} className={`${inputCls} mt-1`} placeholder="ex.: Kit infantil" />
            </label>
            <div className="text-xs text-[#0F1E3C]/60">Produtos somados
              <div className="mt-1 space-y-1 max-h-48 overflow-y-auto border border-[#0F1E3C]/10 rounded-xl p-2">
                {produtos.map(p => (
                  <label key={p.id} className="flex items-center gap-2 text-[#0F1E3C]">
                    <input type="checkbox" checked={nova.produtos.includes(p.id)}
                      onChange={e => setNova({ ...nova, produtos: e.target.checked ? [...nova.produtos, p.id] : nova.produtos.filter(x => x !== p.id) })} />
                    {p.name} <span className="text-[#0F1E3C]/40">{p.materialCost !== null ? fmtBRL(p.materialCost) : "sem custo"}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="block text-xs text-[#0F1E3C]/60">Extra por peça (R$)
              <input value={nova.extra} onChange={e => setNova({ ...nova, extra: e.target.value })} inputMode="decimal" className={`${inputCls} mt-1`} />
            </label>
            <button disabled={ocupado} onClick={async () => { if (await enviar("/api/marketplace/custos", "POST", nova)) setNova(null) }}
              className="w-full bg-[#0F1E3C] text-white text-sm font-semibold rounded-xl px-4 py-2.5 disabled:opacity-40">
              {ocupado ? "Salvando..." : "Salvar e recalcular"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Como lançar (o agente do outro PC lê isso) ──────────────────────────────

const EXEMPLO = `await fetch("/api/marketplace/fechamento", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    dia: "2026-10-14",            // dia das vendas (YYYY-MM-DD)
    loja: "SHP_MARI",             // SHP_MARI, SHP_SAMU ou TKTK_SAMU
    pedidosUpseller: 12,          // quantos pedidos o Upseller mostra no dia (conferência)
    repasse: 401.37,              // o "a receber" que a plataforma mostra, se tiver (conferência)
    ads: 15.00,                   // gasto com anúncio do dia, se tiver
    itens: [                      // 1 linha por item de pedido
      { pedido: "251014ABC123", sku: "kit-inf-pikachu-KIT Bordo-TAM.14",
        titulo: "Kit Camiseta Infantil Pokémon Pikachu", variacao: "KIT Bordo, TAM.14",
        qtd: 1, valor: 54.90, taxa: 12.38, cupom: 2.00, frete: 0 }
    ]
  })
}).then(r => r.json())`

function ComoLancar() {
  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-5 text-sm text-[#0F1E3C]/80 max-w-4xl leading-relaxed">
      <section className="space-y-1.5">
        <h2 className="font-bold text-[#0F1E3C]">Quando</h2>
        <p>Todo dia de manhã, fechando o dia anterior das 3 lojas: SHP_MARI, SHP_SAMU e TKTK_SAMU. Dia que ficou pra trás pode ser lançado depois (o histórico começa em 01/10/2026).</p>
      </section>
      <section className="space-y-1.5">
        <h2 className="font-bold text-[#0F1E3C]">De onde tirar os números</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Shopee (SHP_MARI e SHP_SAMU):</b> relatório de pedidos exportado da própria Shopee (Meus Pedidos → Exportar), com preço, cupom do vendedor, comissão, taxa de serviço e frete por item.</li>
          <li><b>TikTok (TKTK_SAMU):</b> extrato financeiro do Seller Center (Finanças → extrato/liquidações). A lista de pedidos do TikTok some com o pedido depois de liquidado, então dia antigo sai incompleto por lá.</li>
          <li><b>Upseller:</b> só pra conferência. Mande a quantidade de pedidos do dia em <code>pedidosUpseller</code>. Se não bater com o relatório, o lançamento entra com ⚠️ e é pra avisar no grupo.</li>
        </ul>
      </section>
      <section className="space-y-1.5">
        <h2 className="font-bold text-[#0F1E3C]">Como mandar</h2>
        <p>De dentro do navegador logado no painel da SM (console da página), igual às devoluções. Um envio por dia + loja:</p>
        <pre className="bg-[#0F1E3C] text-white/90 text-xs rounded-xl p-4 overflow-x-auto whitespace-pre">{EXEMPLO}</pre>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Valores sempre positivos</b> (taxa, cupom, frete, Ads): o sistema é que subtrai. Número pode ir como 12.5 ou &quot;12,50&quot;.</li>
          <li><b>valor</b> do item = preço de venda do item × quantidade, antes de taxa e cupom. <b>taxa</b> = comissão + taxa de serviço + taxa de transação. <b>cupom</b> = cupom pago pelo vendedor. <b>frete</b> = frete pago pelo vendedor.</li>
          <li>Pedidos, vendas, taxas, cupom e frete do dia são somados dos itens. Se preferir, mande o total direto em <code>pedidos</code>, <code>vendas</code>, <code>taxas</code>, <code>cupom</code>, <code>frete</code>: total mandado vale mais que a soma.</li>
          <li><b>Mandar o mesmo dia + loja de novo substitui tudo</b> (totais e itens). Pode reenviar pra corrigir.</li>
          <li>Dia sem venda: mande <code>{"{ dia, loja, pedidos: 0, vendas: 0 }"}</code> pra ficar registrado que foi zero.</li>
          <li>O custo das peças <b>não</b> precisa mandar: o sistema calcula pelo SKU (aba Custos).</li>
          <li>Pedido cancelado não entra.</li>
        </ul>
      </section>
      <section className="space-y-1.5">
        <h2 className="font-bold text-[#0F1E3C]">Resposta</h2>
        <p><code>{"{ ok: true, id, substituido, fechamento, avisos: [...] }"}</code>. Se <code>avisos</code> vier com alguma coisa (pedidos não batem com o Upseller, repasse diferente, SKU sem custo), avise no grupo com o texto do aviso. Erro volta como <code>{"{ error: \"...\" }"}</code> com status 400: corrija e mande de novo. Nunca chute número: se faltar dado, mande o que tem e escreva o motivo em <code>observacao</code>.</p>
      </section>
    </div>
  )
}
