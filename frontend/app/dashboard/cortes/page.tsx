"use client"

// Cortes terceirizados (PIV 14/11): o cortador lança em /corte (link sem login), aqui quem
// aprova coloca preço do kg, largura e gramatura e o painel calcula o custo por peça.
// Também dá pra aprovar respondendo o aviso no grupo SM Administrativo (lib/cortes.ts).
import { Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Copy, Check } from "lucide-react"
import { colorSwatch } from "@/lib/colorSwatch"
import { calcularCorte, lerDecimal, type CorCorte, type MalhaCorte } from "@/lib/cortesCalc"

type Corte = {
  id: number; codigo: string; cortador: string; productName: string; sizes: string[]; cores: CorCorte[]
  status: "esperando" | "aprovado" | "cancelado"; malha: MalhaCorte
  custoPeca: number | null; aprovadoPor: string | null; aprovadoEm: string | null; createdAt: string
}
type Form = { precoKg: string; largura: string; gramatura: string; maoCorte: string; porCor: boolean; precoCor: Record<string, string> }

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const dec = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " ·")
const tit = { fontFamily: "var(--font-anton), Impact, sans-serif" }
const LINK = "https://smconfeccoes.com.br/corte"

function Bola({ cor }: { cor: string }) {
  return <span className="inline-block w-3.5 h-3.5 rounded-full border border-black/15 flex-none" style={{ background: colorSwatch(cor) }} />
}
function Pill({ s }: { s: Corte["status"] }) {
  return s === "aprovado"
    ? <span className="text-[10.5px] font-extrabold uppercase tracking-wide px-2 py-1 rounded-full bg-[#E0F5EF] text-[#00866A] whitespace-nowrap">Aprovado</span>
    : <span className="text-[10.5px] font-extrabold uppercase tracking-wide px-2 py-1 rounded-full bg-[#FFF4DC] text-[#B06A00] whitespace-nowrap">Falta preço</span>
}

const formDe = (c: Corte): Form => ({
  precoKg: c.malha.precoKg ? dec(c.malha.precoKg, 2) : "",
  largura: c.malha.largura ? dec(c.malha.largura, 2) : "",
  gramatura: c.malha.gramatura ? String(c.malha.gramatura) : "",
  maoCorte: c.malha.maoCorte ? dec(c.malha.maoCorte, 2) : "",
  porCor: c.malha.porCor,
  precoCor: Object.fromEntries(Object.entries(c.malha.precoCor ?? {}).map(([k, v]) => [k, v ? dec(v, 2) : ""])),
})
const malhaDe = (f: Form): MalhaCorte => {
  const pos = (s: string) => { const v = lerDecimal(s); return v > 0 ? v : null }
  return { precoKg: pos(f.precoKg), largura: pos(f.largura), gramatura: pos(f.gramatura), maoCorte: pos(f.maoCorte), porCor: f.porCor,
    precoCor: Object.fromEntries(Object.entries(f.precoCor).map(([k, v]) => [k, pos(v)])) }
}

function Campo({ id, label, value, un, ph, dica, onChange, disabled }: { id: string; label: string; value: string; un: string; ph: string; dica?: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="grid gap-1.5" htmlFor={id}>
      <span className="text-[13px] font-bold">{label}</span>
      <span className="relative">
        <input id={id} inputMode="decimal" value={value} placeholder={ph} disabled={disabled} onChange={e => onChange(e.target.value)}
          className="w-full h-11 rounded-xl border border-[#0F1E3C]/15 bg-[#EEF1F6] pl-3 pr-14 text-[17px] font-extrabold tabular-nums outline-none focus:border-[#4361EE] disabled:opacity-70" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-[#6B7891]">{un}</span>
      </span>
      {dica && <small className="text-xs text-[#6B7891]">{dica}</small>}
    </label>
  )
}

function Tela() {
  const sp = useSearchParams()
  const [cortes, setCortes] = useState<Corte[] | null>(null)
  const [erro, setErro] = useState("")
  const [sel, setSel] = useState<number | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState("")
  const [copiado, setCopiado] = useState(false)

  async function carregar(manter?: number) {
    try {
      const r = await fetch("/api/cortes"); const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? "Erro")
      setCortes(d.cortes)
      const want = manter ?? Number(sp.get("c")) ?? null
      const alvo = (d.cortes as Corte[]).find(c => c.id === want) ?? (d.cortes as Corte[]).find(c => c.status === "esperando") ?? d.cortes[0]
      if (alvo) { setSel(alvo.id); setForm(formDe(alvo)) }
    } catch (e) { setErro(e instanceof Error ? e.message : "Não consegui carregar os cortes") }
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const k = cortes?.find(c => c.id === sel) ?? null
  const malha = useMemo(() => (k && form ? (k.status === "aprovado" ? k.malha : malhaDe(form)) : null), [k, form])
  const ct = k && malha ? calcularCorte(k.cores, malha) : null
  const ap = k?.status === "aprovado"
  const set = (p: Partial<Form>) => setForm(f => (f ? { ...f, ...p } : f))

  async function acao(tipo: "aprovar" | "cancelar") {
    if (!k || !form) return
    setSalvando(true); setMsg("")
    try {
      const m = malhaDe(form)
      const r = await fetch(`/api/cortes/${k.id}`, { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify(tipo === "cancelar" ? { acao: "cancelar" } : { acao: "aprovar", ...m }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? "Não consegui salvar")
      setMsg(tipo === "aprovar" ? "Aprovado. O grupo recebeu o custo por peça." : "Corte cancelado.")
      await carregar(tipo === "aprovar" ? k.id : undefined)
    } catch (e) { setMsg(e instanceof Error ? e.message : "Não consegui salvar") } finally { setSalvando(false) }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(LINK); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch {}
  }

  const card = "bg-white rounded-2xl border border-[#E3E7EF]"
  const th = "px-2.5 py-2 text-[11px] font-extrabold uppercase tracking-wider text-[#6B7891] text-right whitespace-nowrap first:text-left"
  const td = "px-2.5 py-2.5 text-right whitespace-nowrap tabular-nums first:text-left"

  return (
    <div className="max-w-6xl mx-auto grid gap-5 text-[#0F1E3C]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black" style={{ fontFamily: "var(--font-playfair)" }}>Cortes</h1>
          <p className="text-sm text-[#6B7891] mt-1">O cortador lança pelo celular, aqui entra o preço da malha e sai o custo por peça.</p>
        </div>
        <div className="flex items-center gap-2 text-sm bg-white border border-[#E3E7EF] rounded-xl pl-3 pr-1.5 py-1.5">
          <span className="text-[#6B7891]">Link do cortador:</span><b className="select-all">{LINK.replace("https://", "")}</b>
          <button onClick={copiar} className="ml-1 flex items-center gap-1 rounded-lg bg-[#0F1E3C] text-white px-2.5 py-1.5 text-xs font-bold">
            {copiado ? <Check size={14} /> : <Copy size={14} />}{copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
      </div>

      {erro && <p className="text-[#C62828] font-bold">{erro}</p>}
      {!cortes && !erro && <p className="flex items-center gap-2 text-[#6B7891]"><Loader2 className="animate-spin" size={16} /> Carregando…</p>}
      {cortes && cortes.length === 0 && (
        <div className={card + " p-6 text-[#6B7891]"}>Nenhum corte ainda. Manda o link <b className="text-[#0F1E3C]">{LINK.replace("https://", "")}</b> pro cortador: quando ele enviar, o grupo SM Administrativo recebe o aviso e o corte aparece aqui.</div>
      )}

      {cortes && cortes.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
          <aside className={card + " overflow-hidden"}>
            <h3 className="px-4 py-3.5 text-[11px] font-extrabold uppercase tracking-widest text-[#6B7891] border-b border-[#E3E7EF]">Cortes</h3>
            {cortes.map(c => {
              const pc = c.cores.reduce((s, x) => s + Object.values(x.grade).reduce((a, b) => a + b, 0), 0)
              return (
                <button key={c.id} onClick={() => { setSel(c.id); setForm(formDe(c)); setMsg("") }}
                  className={"w-full text-left grid gap-0.5 px-4 py-3 border-t border-[#E3E7EF] first-of-type:border-t-0 " + (c.id === sel ? "bg-[#E8ECFD]" : "hover:bg-[#F6F8FD]")}>
                  <span className="flex justify-between items-center gap-2 font-extrabold">{c.codigo}<Pill s={c.status} /></span>
                  <small className="text-[#6B7891]">{c.productName} · {pc} peças</small>
                  <small className="text-[#6B7891]">{c.cortador} · {quando(c.createdAt)}</small>
                </button>
              )
            })}
          </aside>

          {k && form && ct && (
            <div className="grid gap-4 min-w-0">
              <div className="flex flex-wrap justify-between items-end gap-2.5">
                <div>
                  <h2 className="text-[32px] leading-none uppercase" style={tit}>{k.codigo} · {k.productName}</h2>
                  <p className="text-[#6B7891] mt-1">{k.cortador} · {quando(k.createdAt)} · {ct.pecas} peças · {dec(ct.kg)} kg de malha</p>
                </div>
                <Pill s={k.status} />
              </div>

              <div className={card + " p-4 grid gap-3 min-w-0"}>
                <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[#6B7891]">O que foi cortado</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead><tr className="border-b border-[#E3E7EF]"><th className={th}>Cor</th>{k.sizes.map(t => <th key={t} className={th}>{t}</th>)}<th className={th}>Peças</th><th className={th}>Bobinas</th><th className={th}>Sobra</th><th className={th}>Kg usado</th><th className={th}>Kg/peça</th></tr></thead>
                    <tbody>
                      {ct.linhas.map((l, i) => {
                        const c = k.cores[i]
                        return (
                          <tr key={l.cor} className="border-b border-[#E3E7EF] last:border-0">
                            <td className={td}><span className="flex items-center gap-2 font-bold"><Bola cor={l.cor} />{l.cor}</span></td>
                            {k.sizes.map(t => <td key={t} className={td}>{c.grade[t] ?? 0}</td>)}
                            <td className={td + " font-extrabold"}>{l.pecas}</td>
                            <td className={td}>{c.bobinas.map(b => dec(b)).join(" + ")}</td>
                            <td className={td}>{c.sobra ? dec(c.sobra) : "–"}</td>
                            <td className={td}>{dec(l.kg)}</td>
                            <td className={td}>{dec(l.kgPeca, 3)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot><tr className="border-t-2 border-[#E3E7EF] font-extrabold"><td className={td}>Total</td>{k.sizes.map(t => <td key={t} className={td}>{k.cores.reduce((s, c) => s + (c.grade[t] ?? 0), 0)}</td>)}<td className={td}>{ct.pecas}</td><td className={td} /><td className={td} /><td className={td}>{dec(ct.kg)}</td><td className={td}>{dec(ct.pecas ? ct.kg / ct.pecas : 0, 3)}</td></tr></tfoot>
                  </table>
                </div>
                {ct.gastoAlto.length > 0 && (
                  <div className="rounded-xl bg-[#FFF4DC] px-3.5 py-3 text-sm">⚠️ <b className="text-[#B06A00]">{ct.gastoAlto.join(", ")}</b> gastou mais de 15% de malha por peça acima da média do corte. Vale perguntar pro cortador se a bobina tinha defeito ou se faltou pesar a sobra.</div>
                )}
              </div>

              <div className={card + " p-4 grid gap-3.5"}>
                <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[#6B7891]">Malha {ap ? "" : "(quem aprova preenche)"}</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Campo id="f-preco" label="Preço do kg" value={form.precoKg} un="R$/kg" ph="38,90" dica="Da nota da malharia" disabled={ap} onChange={v => set({ precoKg: v })} />
                  <Campo id="f-larg" label="Largura" value={form.largura} un="m" ph="1,80" dica="Largura aberta da malha" disabled={ap} onChange={v => set({ largura: v })} />
                  <Campo id="f-gram" label="Gramatura" value={form.gramatura} un="g/m²" ph="160" dica="Vem na etiqueta da bobina" disabled={ap} onChange={v => set({ gramatura: v })} />
                </div>
                <label className="flex items-center gap-2.5 font-bold text-sm">
                  <input type="checkbox" className="w-[18px] h-[18px] accent-[#4361EE]" checked={form.porCor} disabled={ap} onChange={e => set({ porCor: e.target.checked })} />
                  Preço do kg diferente por cor (ex.: branco mais barato)
                </label>
                {form.porCor && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {k.cores.map((c, i) => <Campo key={c.cor} id={`f-pc-${i}`} label={c.cor} value={form.precoCor[c.cor] ?? form.precoKg} un="R$/kg" ph={form.precoKg || "38,90"} disabled={ap}
                      onChange={v => set({ precoCor: { ...form.precoCor, [c.cor]: v } })} />)}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Campo id="f-mao" label="Corte por peça (opcional)" value={form.maoCorte} un="R$" ph="0,50" dica="Se o cortador cobra por peça, soma no custo" disabled={ap} onChange={v => set({ maoCorte: v })} />
                </div>
              </div>

              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                <div className="rounded-2xl p-3.5 grid gap-0.5 bg-[#0F1E3C] text-white"><small className="text-white/70 font-bold text-xs">Custo por peça (tecido{malha?.maoCorte ? " + corte" : ""})</small><b className="text-[28px] leading-tight text-[#F4C430] tabular-nums" style={tit}>{ct.porPeca != null ? brl(ct.porPeca) : "–"}</b></div>
                <div className={card + " p-3.5 grid gap-0.5"}><small className="text-[#6B7891] font-bold text-xs">Malha do corte</small><b className="text-[28px] leading-tight tabular-nums" style={tit}>{ct.tecido != null ? brl(ct.tecido) : "–"}</b></div>
                <div className={card + " p-3.5 grid gap-0.5"}><small className="text-[#6B7891] font-bold text-xs">Metros de malha</small><b className="text-[28px] leading-tight tabular-nums" style={tit}>{ct.metros != null ? `${dec(ct.metros)} m` : "–"}</b></div>
                <div className={card + " p-3.5 grid gap-0.5"}><small className="text-[#6B7891] font-bold text-xs">Consumo por peça</small><b className="text-[28px] leading-tight tabular-nums" style={tit}>{ct.metros != null && ct.pecas ? `${dec(ct.metros / ct.pecas, 2)} m` : `${dec(ct.pecas ? (ct.kg / ct.pecas) * 1000 : 0, 0)} g`}</b></div>
              </div>

              {ct.porPeca != null && ct.linhas.length > 1 && (
                <div className={card + " p-4 grid gap-3 min-w-0"}>
                  <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[#6B7891]">Custo por cor</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead><tr className="border-b border-[#E3E7EF]"><th className={th}>Cor</th><th className={th}>Peças</th><th className={th}>Kg</th><th className={th}>R$/kg</th><th className={th}>Malha</th>{ct.metros != null && <th className={th}>Metros</th>}<th className={th}>Por peça</th></tr></thead>
                      <tbody>{ct.linhas.map(l => (
                        <tr key={l.cor} className="border-b border-[#E3E7EF] last:border-0">
                          <td className={td}><span className="flex items-center gap-2 font-bold"><Bola cor={l.cor} />{l.cor}</span></td>
                          <td className={td}>{l.pecas}</td><td className={td}>{dec(l.kg)}</td><td className={td}>{l.precoKg ? dec(l.precoKg, 2) : "–"}</td>
                          <td className={td}>{l.tecido != null ? brl(l.tecido) : "–"}</td>{ct.metros != null && <td className={td}>{l.metros != null ? dec(l.metros) : "–"}</td>}
                          <td className={td + " font-extrabold"}>{l.porPeca != null ? brl(l.porPeca) : "–"}</td>
                        </tr>))}</tbody>
                    </table>
                  </div>
                </div>
              )}
              <p className="text-xs text-[#6B7891]">É a média da grade: G e GG gastam mais malha que P, mas o custo sai igual pra todas. Só tecido{malha?.maoCorte ? " e corte" : ""}, sem costura e estampa.</p>

              {msg && <div className={"rounded-xl px-3.5 py-3 font-bold text-sm " + (/^(Aprovado|Corte cancelado)/.test(msg) ? "bg-[#E0F5EF]" : "bg-[#FFF4DC]")}>{msg}</div>}
              {ap ? (
                <div className="rounded-xl px-3.5 py-3 font-bold text-sm bg-[#E0F5EF]">✅ Aprovado{k.aprovadoPor ? ` por ${k.aprovadoPor}` : ""}{k.aprovadoEm ? ` em ${quando(k.aprovadoEm)}` : ""}.</div>
              ) : (
                <div className="flex flex-wrap justify-end gap-2.5">
                  <button disabled={salvando} onClick={() => acao("cancelar")} className="rounded-xl border border-[#E3E7EF] bg-white px-4 py-3 font-bold text-sm">Cancelar corte</button>
                  <button disabled={salvando || ct.porPeca == null || !malha?.largura || !malha?.gramatura} onClick={() => acao("aprovar")}
                    className="rounded-xl bg-[#0F1E3C] text-white px-5 py-3 font-extrabold text-sm disabled:opacity-40 flex items-center gap-2">
                    {salvando && <Loader2 className="animate-spin" size={15} />}Aprovar corte
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CortesPage() {
  return <Suspense fallback={null}><Tela /></Suspense>
}
