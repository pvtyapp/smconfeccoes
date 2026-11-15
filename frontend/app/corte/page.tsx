"use client"

// Tela do cortador terceirizado (PIV 14/11): sem login, só o domínio. 5 passos com botão
// grande: produto → cores → grade → peso das bobinas → confere e envia. O envio avisa o
// grupo SM Administrativo, que coloca o preço da malha (lib/cortes.ts).
import { useEffect, useMemo, useState } from "react"
import { colorSwatch } from "@/lib/colorSwatch"
import { kgDaCor, lerDecimal, pecasDaCor, type CorCorte } from "@/lib/cortesCalc"

type Produto = { id: string; name: string; sizes: string[]; colors: string[] }
const PASSOS = ["Qual produto você cortou?", "Quais cores?", "Quantas peças de cada tamanho?", "Quanto pesou cada bobina?", "Confere e envia"]
const NAVY = "#0F1E3C", ROYAL = "#4361EE"
const tit = { fontFamily: "var(--font-anton), Impact, sans-serif" }
const dec = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })

function Bola({ cor, size = 22 }: { cor: string; size?: number }) {
  return <span className="inline-block flex-none rounded-full border border-black/15" style={{ width: size, height: size, background: colorSwatch(cor) }} />
}

export default function CortePage() {
  const [produtos, setProdutos] = useState<Produto[] | null>(null)
  const [erroCarga, setErroCarga] = useState("")
  const [nome, setNome] = useState("")
  const [passo, setPasso] = useState(0)
  const [prodId, setProdId] = useState<string>("")
  const [cores, setCores] = useState<string[]>([])
  const [corAtiva, setCorAtiva] = useState("")
  const [grade, setGrade] = useState<Record<string, Record<string, number>>>({})
  const [bob, setBob] = useState<Record<string, number[]>>({})

  const [kgDigitado, setKgDigitado] = useState<Record<string, string>>({})
  const [kgErro, setKgErro] = useState<string>("")
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState("")
  const [codigo, setCodigo] = useState("")

  useEffect(() => {
    try { setNome(localStorage.getItem("sm-cortador") ?? "") } catch {}
    fetch("/api/cortes/publico").then(r => r.json()).then(d => {
      if (Array.isArray(d.produtos)) setProdutos(d.produtos); else setErroCarga(d.error ?? "Não consegui carregar os produtos")
    }).catch(() => setErroCarga("Sem internet? Não consegui carregar os produtos"))
  }, [])

  const P = useMemo(() => produtos?.find(p => p.id === prodId) ?? null, [produtos, prodId])
  const linha = (c: string): CorCorte => ({ cor: c, grade: grade[c] ?? {}, bobinas: bob[c] ?? [], sobra: 0 })
  const pecas = (c: string) => pecasDaCor(linha(c))
  const kgLiq = (c: string) => kgDaCor(linha(c))

  function escolheProduto(id: string) {
    if (id !== prodId) { setProdId(id); setCores([]); setGrade({}); setBob({}) }
  }
  function alternaCor(c: string) {
    setCores(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c])
  }
  function mudaGrade(t: string, v: number) {
    setGrade(g => ({ ...g, [ativa]: { ...(g[ativa] ?? {}), [t]: Math.max(0, v) } }))
  }
  function copiaGrade() {
    const g = grade[ativa] ?? {}
    setGrade(Object.fromEntries(cores.map(c => [c, { ...g }])))
  }
  function addBobina(c: string) {
    const v = lerDecimal(kgDigitado[c])
    if (!(v > 0) || v > 300) { setKgErro(c); return }
    setKgErro("")
    setBob(b => ({ ...b, [c]: [...(b[c] ?? []), Math.round(v * 10) / 10] }))
    setKgDigitado(k => ({ ...k, [c]: "" }))
  }
  function tiraBobina(c: string, i: number) {
    setBob(b => ({ ...b, [c]: (b[c] ?? []).filter((_, k) => k !== i) }))
  }

  async function enviar() {
    if (!P) return
    setEnviando(true); setErroEnvio("")
    try { localStorage.setItem("sm-cortador", nome.trim()) } catch {}
    try {
      const r = await fetch("/api/cortes/publico", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cortador: nome.trim(), productId: P.id, cores: cores.map(linha) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Não consegui enviar, tenta de novo")
      setCodigo(d.codigo); setPasso(5)
    } catch (e) {
      setErroEnvio(e instanceof Error ? e.message : "Não consegui enviar, tenta de novo")
    } finally { setEnviando(false) }
  }

  function novo() { setPasso(0); setProdId(""); setCores([]); setGrade({}); setBob({}); setCodigo("") }

  const podeIr =
    passo === 0 ? !!P && nome.trim().length > 1 :
    passo === 1 ? cores.length > 0 :
    passo === 2 ? cores.every(c => pecas(c) > 0) :
    passo === 3 ? cores.every(c => kgLiq(c) > 0) : true

  // cor ativa da grade sempre uma das escolhidas
  const ativa = cores.includes(corAtiva) ? corAtiva : cores[0] ?? ""

  const btn = "rounded-2xl px-5 py-4 font-extrabold text-base transition-opacity"
  const card = "bg-white border border-[#E3E7EF] rounded-2xl"

  return (
    <div className="min-h-dvh bg-[#EEF1F6] text-[#0F1E3C] flex justify-center">
      <div className="w-full max-w-[480px] min-h-dvh flex flex-col">
        <header className="px-5 pt-5 pb-4 grid gap-3" style={{ background: NAVY, color: "#fff" }}>
          <div className="flex items-center justify-between">
            <b className="text-[22px] uppercase tracking-wide" style={tit}>Novo corte</b>
            <small className="text-white/60 font-semibold">SM Confecções</small>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {PASSOS.map((_, i) => <i key={i} className="h-1 rounded" style={{ background: i <= Math.min(passo, 4) ? "#F4C430" : "rgba(255,255,255,.18)" }} />)}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 grid gap-3 content-start">
          {passo < 5 && <h1 className="text-[26px] leading-[1.05] uppercase" style={tit}>{PASSOS[passo]}</h1>}

          {passo === 0 && (<>
            <label className="grid gap-1.5">
              <span className="text-sm font-bold">Seu nome</span>
              <input id="nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Zé do corte" autoComplete="name"
                className="h-12 rounded-xl border-2 border-[#E3E7EF] bg-white px-4 text-lg font-bold focus:border-[#4361EE] outline-none" />
            </label>
            {!produtos && !erroCarga && <p className="text-[#6B7891]">Carregando os produtos…</p>}
            {erroCarga && <p className="text-[#C62828] font-bold">{erroCarga}</p>}
            <div className="grid grid-cols-2 gap-2.5">
              {produtos?.map(p => (
                <button key={p.id} onClick={() => escolheProduto(p.id)} aria-pressed={p.id === prodId}
                  className="text-left rounded-2xl border-2 p-3.5 min-h-[84px] grid gap-1 content-start"
                  style={{ borderColor: p.id === prodId ? ROYAL : "#E3E7EF", background: p.id === prodId ? "#E8ECFD" : "#fff" }}>
                  <b className="text-[15px] leading-tight">{p.name}</b>
                  <small className="text-[#6B7891] text-xs">{p.sizes.join(" · ")}</small>
                </button>
              ))}
            </div>
          </>)}

          {passo === 1 && P && (<>
            <p className="text-sm text-[#6B7891] -mt-1">{P.name}. Toca em todas que você cortou.</p>
            <div className="grid grid-cols-2 gap-2">
              {P.colors.map(c => {
                const on = cores.includes(c)
                return (
                  <button key={c} onClick={() => alternaCor(c)} aria-pressed={on}
                    className="flex items-center gap-2.5 rounded-2xl border-2 px-3 py-3 text-left font-bold text-sm"
                    style={{ borderColor: on ? ROYAL : "#E3E7EF", background: on ? "#E8ECFD" : "#fff" }}>
                    <Bola cor={c} />{c}
                    <span className="ml-auto w-5 h-5 rounded-md border-2 grid place-items-center text-white text-xs"
                      style={{ background: on ? ROYAL : "transparent", borderColor: on ? ROYAL : "#E3E7EF" }}>✓</span>
                  </button>
                )
              })}
            </div>
          </>)}

          {passo === 2 && P && ativa && (<>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {cores.map(c => (
                <button key={c} onClick={() => setCorAtiva(c)}
                  className="flex-none flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-bold text-[13px]"
                  style={c === ativa ? { background: NAVY, color: "#fff", borderColor: NAVY } : { background: "#fff", borderColor: "#E3E7EF" }}>
                  <Bola cor={c} size={14} />{c} <em className="not-italic text-[11px] opacity-70 tabular-nums">{pecas(c)}</em>
                </button>
              ))}
            </div>
            <div className={card + " overflow-hidden"}>
              {P.sizes.map((t, i) => {
                const v = grade[ativa]?.[t] ?? 0
                return (
                  <div key={t} className={"grid grid-cols-[52px_1fr] items-center gap-2 px-3 py-2.5" + (i ? " border-t border-[#E3E7EF]" : "")}>
                    <span className="text-[22px] text-center" style={tit}>{t}</span>
                    <div className="grid grid-cols-[44px_1fr_44px_52px] gap-1.5">
                      <button onClick={() => mudaGrade(t, v - 1)} aria-label={`Menos 1 no ${t}`} className="h-11 rounded-xl border border-[#E3E7EF] bg-[#EEF1F6] text-lg font-extrabold">−</button>
                      <input id={`g-${t}`} inputMode="numeric" value={v || ""} placeholder="0" aria-label={`Peças no ${t}`}
                        onChange={e => mudaGrade(t, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)}
                        className="h-11 min-w-0 rounded-xl border border-[#E3E7EF] text-center text-xl font-extrabold tabular-nums outline-none focus:border-[#4361EE]" />
                      <button onClick={() => mudaGrade(t, v + 1)} aria-label={`Mais 1 no ${t}`} className="h-11 rounded-xl border border-[#E3E7EF] bg-[#EEF1F6] text-lg font-extrabold">+</button>
                      <button onClick={() => mudaGrade(t, v + 10)} className="h-11 rounded-xl bg-[#E8ECFD] text-[13px] font-extrabold" style={{ color: ROYAL }}>+10</button>
                    </div>
                  </div>
                )
              })}
            </div>
            {cores.length > 1 && (
              <button onClick={copiaGrade} className="rounded-xl border border-dashed py-3 font-bold text-sm" style={{ borderColor: ROYAL, color: ROYAL }}>
                Usar essa grade em todas as cores
              </button>
            )}
            <div className="flex justify-between items-center rounded-2xl px-4 py-3 text-white" style={{ background: NAVY }}>
              <span>{ativa}</span><b className="text-[26px] tabular-nums" style={tit}>{pecas(ativa)} peças</b>
            </div>
          </>)}

          {passo === 3 && (<>
            <p className="text-sm text-[#6B7891] -mt-1">Pesa cada bobina que usou nessa cor e digita o kg. Usou mais de uma, adiciona de novo.</p>
            {cores.map(c => (
              <div key={c} className={card + " p-3 grid gap-2.5"}>
                <div className="flex items-center gap-2 font-extrabold"><Bola cor={c} />{c}<span className="ml-auto text-[13px] text-[#6B7891] font-bold tabular-nums">{pecas(c)} peças</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {(bob[c] ?? []).length === 0 && <span className="text-[13px] text-[#6B7891]">Nenhuma bobina ainda</span>}
                  {(bob[c] ?? []).map((v, i) => (
                    <span key={i} className="flex items-center gap-1.5 rounded-full bg-[#E8ECFD] pl-3 pr-1.5 py-1.5 font-extrabold text-sm tabular-nums">
                      {dec(v)} kg <button onClick={() => tiraBobina(c, i)} aria-label="Tirar bobina" className="w-[22px] h-[22px] rounded-full bg-white text-xs text-[#6B7891]">✕</button>
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <div className="relative">
                    <input id={`kg-${c}`} inputMode="decimal" placeholder="Ex: 13,8" value={kgDigitado[c] ?? ""}
                      onChange={e => setKgDigitado(k => ({ ...k, [c]: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addBobina(c) } }}
                      aria-label={`Peso da bobina de ${c} em kg`}
                      className="w-full h-[50px] rounded-xl border-2 bg-[#EEF1F6] pl-3.5 pr-11 text-xl font-extrabold tabular-nums outline-none focus:border-[#4361EE]"
                      style={{ borderColor: kgErro === c ? "#C77700" : "#E3E7EF" }} />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#6B7891] font-extrabold">kg</span>
                  </div>
                  <button onClick={() => addBobina(c)} className="h-[50px] px-4 rounded-2xl font-extrabold text-white" style={{ background: NAVY }}>Adicionar</button>
                </div>
                {kgErro === c && <p className="text-[13px] font-bold text-[#C77700] -mt-1">Digita o peso da bobina, ex: 13,8</p>}
                <div className="flex justify-between text-[13px] border-t border-dashed border-[#E3E7EF] pt-2">
                  <span>Total das bobinas</span><b className="text-[15px] tabular-nums">{dec(kgLiq(c))} kg</b>
                </div>
              </div>
            ))}
          </>)}

          {passo === 4 && P && (<>
            <div className={card + " p-3.5 grid gap-2"}>
              <div className="flex justify-between gap-2 text-sm font-bold">
                <span>{P.name}</span>
                <span className="tabular-nums text-[#6B7891]">{cores.reduce((s, c) => s + pecas(c), 0)} peças · {dec(cores.reduce((s, c) => s + kgLiq(c), 0))} kg</span>
              </div>
              {cores.map(c => (
                <div key={c} className="flex justify-between gap-2 text-sm border-t border-[#E3E7EF] pt-2">
                  <span className="flex items-center gap-2 font-bold"><Bola cor={c} size={16} />{c}</span>
                  <span className="text-right text-[#6B7891] tabular-nums">
                    {P.sizes.filter(t => (grade[c]?.[t] ?? 0) > 0).map(t => `${t} ${grade[c][t]}`).join(" · ")}<br />
                    {(bob[c] ?? []).length} bobina(s) · {dec(kgLiq(c))} kg
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm text-[#6B7891]">Cortado por <b className="text-[#0F1E3C]">{nome.trim()}</b>. Depois de enviar, a SM coloca o preço da malha.</p>
            {erroEnvio && <p className="font-bold text-[#C62828]">{erroEnvio}</p>}
          </>)}

          {passo === 5 && (
            <div className="grid place-items-center text-center gap-3 py-10">
              <div className="w-[72px] h-[72px] rounded-full grid place-items-center text-4xl text-white" style={{ background: "#00A884" }}>✓</div>
              <h1 className="text-[30px] uppercase" style={tit}>Corte enviado</h1>
              <p className="text-[#6B7891]">Código <b className="text-[#0F1E3C]">{codigo}</b>. A SM já recebeu. Você não precisa fazer mais nada.</p>
            </div>
          )}
        </main>

        <footer className="sticky bottom-0 bg-white border-t border-[#E3E7EF] p-4 flex gap-2.5" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          {passo > 0 && passo < 5 && <button onClick={() => setPasso(passo - 1)} className={btn + " bg-white border border-[#E3E7EF]"}>Voltar</button>}
          {passo < 4 && <button disabled={!podeIr} onClick={() => setPasso(passo + 1)} className={btn + " flex-1 text-white disabled:opacity-40"} style={{ background: ROYAL }}>Continuar</button>}
          {passo === 4 && <button disabled={enviando} onClick={enviar} className={btn + " flex-1 text-white disabled:opacity-60"} style={{ background: "#00A884" }}>{enviando ? "Enviando…" : "Enviar corte"}</button>}
          {passo === 5 && <button onClick={novo} className={btn + " flex-1 text-white"} style={{ background: ROYAL }}>Lançar outro corte</button>}
        </footer>
      </div>
    </div>
  )
}
