"use client"

import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react"
import { Check, Minus, Plus, ShoppingCart, Layers, AlertTriangle } from "lucide-react"
import { colorSwatch } from "@/lib/colorSwatch"
import { sizeCompare } from "@/lib/sizeOrder"

// Cards da aba Lançar — mesma estrutura do catálogo do Vision Commerce
// (opção → tamanho → quantidade → Adicionar), sem foto, nas cores do SM.

export type CatalogVariant = {
  variantId: string; productId: string; productName: string
  color: string; size: string; sku: string; availableStock: number
}
export type KitTemplateItem = { templateId: number; productId: string; productName: string }
export type KitTemplate = { id: number; nome: string; createdAt: string; items: KitTemplateItem[] }

const chipBase = "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors"
const chipOn = "border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]"
const chipOff = "border-[#0F1E3C]/12 text-[#0F1E3C]/65 hover:border-[#4361EE]/40"
const label = "text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/35 mb-1.5"

function Swatch({ color, size = 12 }: { color: string; size?: number }) {
  return <span className="rounded-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)] flex-shrink-0" style={{ width: size, height: size, background: colorSwatch(color) }} />
}

function QtyStepper({ value, onChange, testId }: { value: number; onChange: (n: number) => void; testId?: string }) {
  return (
    <div className="flex items-center gap-1 bg-[#F4F6FB] border border-[#0F1E3C]/10 rounded-xl px-1.5 py-1">
      <button type="button" aria-label="Menos" onClick={() => onChange(Math.max(1, value - 1))} className="p-1 text-[#0F1E3C]/45 hover:text-[#0F1E3C]"><Minus size={13} /></button>
      <input data-testid={testId} type="number" min={1} value={value} onChange={e => onChange(Math.max(1, parseInt(e.target.value) || 1))}
        className="w-9 bg-transparent text-center text-sm font-black text-[#0F1E3C] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
      <button type="button" aria-label="Mais" onClick={() => onChange(value + 1)} className="p-1 text-[#0F1E3C]/45 hover:text-[#0F1E3C]"><Plus size={13} /></button>
    </div>
  )
}

function AddButton({ ready, done, idle, onClick, testId }: {
  ready: boolean; done: boolean; idle: string; onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void; testId?: string
}) {
  return (
    <button type="button" data-testid={testId} onClick={onClick} disabled={!ready}
      className={`flex-1 inline-flex items-center justify-center gap-2 text-sm font-bold py-2.5 rounded-xl transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
        done ? "bg-emerald-500 text-white" : "bg-[#4361EE] hover:bg-[#3651d4] text-white"
      }`}>
      {done ? <><Check size={15} /> Adicionado</> : <><ShoppingCart size={14} /> {idle}</>}
    </button>
  )
}

function useFlash() {
  const [on, setOn] = useState(false)
  return [on, () => { setOn(true); setTimeout(() => setOn(false), 1300) }] as const
}

// ── Produto ──────────────────────────────────────────────────────────────────
export function ProdutoCard({ productName, variants, cartQtyFor, onAdd }: {
  productName: string
  variants: CatalogVariant[]
  cartQtyFor: (variantId: string) => number
  onAdd: (v: CatalogVariant, qty: number, origem: DOMRect) => void
}) {
  const cores = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of variants) m.set(v.color, (m.get(v.color) ?? 0) + v.availableStock)
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [variants])
  const [cor, setCor] = useState(cores.length === 1 ? cores[0][0] : "")
  const tamanhos = useMemo(() => variants.filter(v => v.color === cor).sort((a, b) => sizeCompare(a.size, b.size)), [variants, cor])
  const [tamId, setTamId] = useState("")
  const [qtd, setQtd] = useState(1)
  const [done, flash] = useFlash()
  const variante = tamanhos.find(v => v.variantId === tamId)
  const estoqueTotal = variants.reduce((s, v) => s + v.availableStock, 0)
  const faltaEstoque = variante && variante.availableStock < qtd + cartQtyFor(variante.variantId)

  function adicionar(e: ReactMouseEvent<HTMLButtonElement>) {
    if (!variante) return
    flash()
    onAdd(variante, qtd, e.currentTarget.getBoundingClientRect())
    setQtd(1)
  }

  return (
    <div data-testid={`mkt-produto-${variants[0]?.productId}`} className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-4 flex flex-col">
      <div className="mb-3">
        <p className="text-[15px] font-black text-[#0F1E3C] leading-snug">{productName}</p>
        <p className="text-[11px] text-[#0F1E3C]/40 mt-0.5 tabular-nums">
          {cores.length} {cores.length === 1 ? "cor" : "cores"} · {estoqueTotal} disponíveis
        </p>
      </div>

      <p className={label}>Cor</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {cores.map(([c, est]) => (
          <button key={c} type="button" onClick={() => { setCor(c); setTamId(""); setQtd(1) }}
            className={`${chipBase} ${cor === c ? chipOn : chipOff}`}>
            <Swatch color={c} /> {c} <span className={`ml-0.5 px-1 rounded text-[10px] font-semibold tabular-nums ${est === 0 ? "bg-orange-100 text-orange-600" : "bg-[#0F1E3C]/5 opacity-70"}`}>{est}</span>
          </button>
        ))}
      </div>

      <p className={label}>Tamanho</p>
      <div className="mb-3 min-h-[40px]">
        {!cor ? (
          <p className="text-[11px] text-[#0F1E3C]/35 pt-1.5">Escolha a cor pra ver os tamanhos.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tamanhos.map(v => {
              const noCarrinho = cartQtyFor(v.variantId)
              const sem = v.availableStock === 0
              return (
                <button key={v.variantId} type="button" onClick={() => { setTamId(v.variantId); setQtd(1) }}
                  title={sem ? "Sem estoque disponível no sistema" : `${v.availableStock} disponíveis`}
                  className={`relative flex flex-col items-center justify-center min-w-[50px] px-2.5 py-1 rounded-lg border transition-colors ${tamId === v.variantId ? chipOn : sem ? "border-orange-200 bg-orange-50/60 text-orange-500 hover:border-orange-300" : chipOff}`}>
                  <span className="text-[13px] font-black leading-tight">{v.size || "U"}</span>
                  <span className="text-[9px] font-semibold opacity-55 tabular-nums leading-tight">{sem ? "sem estoque" : `${v.availableStock} un`}</span>
                  {noCarrinho > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 bg-[#0F1E3C] text-white rounded-full text-[9px] font-black flex items-center justify-center tabular-nums">{noCarrinho}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {faltaEstoque && (
        <p className="text-[11px] font-semibold text-orange-600 flex items-center gap-1 mb-2">
          <AlertTriangle size={12} /> Só {variante!.availableStock} no sistema, o estoque vai ficar negativo
        </p>
      )}

      <div className="mt-auto pt-3 border-t border-[#0F1E3C]/6 flex items-center gap-2">
        <QtyStepper value={qtd} onChange={setQtd} />
        <AddButton ready={!!variante} done={done} onClick={adicionar}
          idle={variante ? "Adicionar" : !cor ? "Escolha a cor" : "Escolha o tamanho"} />
      </div>
    </div>
  )
}

// ── Kit ──────────────────────────────────────────────────────────────────────
// Cor de cada peça primeiro (peça com 1 cor só resolve sozinha), tamanho depois
// já filtrado pelas cores escolhidas — mesma regra da sub-aba Kit antiga.
export function KitCard({ template, catalog, onAdd }: {
  template: KitTemplate
  catalog: CatalogVariant[]
  onAdd: (pieces: CatalogVariant[], qty: number, groupId: string, origem: DOMRect) => void
}) {
  const [cores, setCores] = useState<Record<string, string>>({})
  const [tam, setTam] = useState("")
  const [qtd, setQtd] = useState(1)
  const [done, flash] = useFlash()

  const pecas = useMemo(() => template.items.map(it => {
    const opcoes = [...new Set(catalog.filter(c => c.productId === it.productId).map(c => c.color))].sort((a, b) => a.localeCompare(b))
    const cor = opcoes.length === 1 ? opcoes[0] : (cores[it.productId] ?? null)
    return { productId: it.productId, productName: it.productName, opcoes, cor }
  }), [template, catalog, cores])
  const coresProntas = pecas.length > 0 && pecas.every(p => p.cor != null)

  const tamanhos = useMemo(() => {
    if (!coresProntas) return []
    const sets = pecas.map(p => new Set(catalog.filter(v => v.productId === p.productId && v.color === p.cor).map(v => v.size)))
    const [first, ...rest] = sets
    return first ? [...first].filter(s => rest.every(set => set.has(s))).sort(sizeCompare) : []
  }, [coresProntas, pecas, catalog])
  const tamEf = tamanhos.includes(tam) ? tam : ""

  const resolvidas = coresProntas && tamEf
    ? pecas.map(p => catalog.find(v => v.productId === p.productId && v.color === p.cor && v.size === tamEf) ?? null)
    : []
  const pronto = resolvidas.length > 0 && resolvidas.every(Boolean)
  const faltando = pronto ? (resolvidas as CatalogVariant[]).filter(v => v.availableStock < qtd) : []

  function adicionar(e: ReactMouseEvent<HTMLButtonElement>) {
    if (!pronto) return
    // Determinístico (modelo+tamanho+cores): o mesmo kit soma no grupo que já
    // está no carrinho em vez de abrir outro.
    const groupId = `kit-${template.id}-${tamEf}-${pecas.map(p => p.cor).join("-")}`
    flash()
    onAdd(resolvidas as CatalogVariant[], qtd, groupId, e.currentTarget.getBoundingClientRect())
    setQtd(1)
  }

  return (
    <div data-testid={`mkt-kit-${template.id}`} className="bg-white rounded-2xl border border-[#4361EE]/20 shadow-sm p-4 flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[15px] font-black text-[#0F1E3C] leading-snug">{template.nome}</p>
          <p className="text-[11px] text-[#0F1E3C]/40 mt-0.5">{template.items.map(i => i.productName).join(" + ")}</p>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-[#4361EE] bg-[#4361EE]/10 rounded-full px-2 py-0.5 flex-shrink-0">
          <Layers size={11} /> Kit
        </span>
      </div>

      <div className="space-y-2.5 mb-3">
        {pecas.map(p => (
          <div key={p.productId}>
            <p className={label}>Cor · {p.productName}</p>
            {p.opcoes.length <= 1 ? (
              <p className="text-[11px] text-[#0F1E3C]/45 flex items-center gap-1.5">
                {p.opcoes[0] ? <><Swatch color={p.opcoes[0]} size={10} /> {p.opcoes[0]} (única)</> : "sem variação ativa"}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {p.opcoes.map(c => (
                  <button key={c} type="button" onClick={() => { setCores(prev => ({ ...prev, [p.productId]: c })); setTam("") }}
                    className={`${chipBase} ${p.cor === c ? chipOn : chipOff}`}>
                    <Swatch color={c} /> {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className={label}>Tamanho</p>
      <div className="mb-3 min-h-[40px]">
        {!coresProntas ? (
          <p className="text-[11px] text-[#0F1E3C]/35 pt-1.5">Escolha a cor de cada peça pra ver os tamanhos.</p>
        ) : tamanhos.length === 0 ? (
          <p className="text-[11px] text-red-500 pt-1.5">Essas cores não têm tamanho em comum entre as peças.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tamanhos.map(s => (
              <button key={s} type="button" onClick={() => setTam(s)} className={`${chipBase} min-w-[46px] justify-center ${tamEf === s ? chipOn : chipOff}`}>{s}</button>
            ))}
          </div>
        )}
      </div>

      {faltando.length > 0 && (
        <p className="text-[11px] font-semibold text-orange-600 flex items-start gap-1 mb-2">
          <AlertTriangle size={12} className="mt-px flex-shrink-0" />
          Pouco estoque: {faltando.map(v => `${v.productName} (${v.availableStock})`).join(", ")}
        </p>
      )}

      <div className="mt-auto pt-3 border-t border-[#0F1E3C]/6 flex items-center gap-2">
        <QtyStepper value={qtd} onChange={setQtd} />
        <AddButton ready={pronto} done={done} onClick={adicionar}
          idle={pronto ? "Adicionar kit" : !coresProntas ? "Escolha as cores" : "Escolha o tamanho"} />
      </div>
    </div>
  )
}
