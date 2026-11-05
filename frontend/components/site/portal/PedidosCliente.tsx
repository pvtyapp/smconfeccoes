"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import PdvReceiptModal, { type SaleReceipt } from "@/app/dashboard/pdv/PdvReceiptModal"
import OrderEditModal from "@/app/portal/OrderEditModal"
import { loadCart, saveCart, type CartItem } from "@/app/catalogo/cart"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"
import { brl } from "../util"

export type ItemPedido = {
  id: number; productName: string; color: string | null; size: string | null; qty: number; unitPrice: number | null
  variantId?: string | null; productId?: string | null
}
export type Pedido = {
  id: number; number: string; status: string; source: string
  totalValue: number | null; paymentMethod: string | null; paidAt: string | null; dueDate: string | null
  createdAt: string; contactName: string | null; contactPhone: string | null
  fiscalNoteId: number | null; fiscalNoteStatus: string | null; items: ItemPedido[]
}

// Etapas na ordem em que o pedido anda (mesmos status do painel).
const ETAPAS = [
  { st: "triagem", nome: "Em análise" },
  { st: "em_separacao", nome: "Em separação" },
  { st: "pronto", nome: "Pronto" },
  { st: "concluido", nome: "Concluído" },
]
const POR_PAGINA = 10

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR")
function vencido(d: string) {
  const due = new Date(d); due.setHours(0, 0, 0, 0)
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return due < hoje
}

export function emAberto(pedidos: Pedido[]) {
  return pedidos.filter((o) => !o.paidAt && o.status !== "cancelado" && o.dueDate)
}

function recibo(o: Pedido): SaleReceipt {
  return {
    id: o.id, number: o.number, total: Number(o.totalValue ?? 0), paymentMethod: o.paymentMethod ?? "pix",
    // dueDate do recibo é "YYYY-MM-DD" puro (convenção do PDV); da API vem timestamp completo.
    dueDate: o.dueDate ? o.dueDate.slice(0, 10) : undefined,
    paidAt: o.paidAt, contact: { name: o.contactName, phone: o.contactPhone },
    items: o.items.map((it, i) => ({ key: `${o.id}-${i}`, productName: it.productName, color: it.color ?? "", size: it.size ?? "", qty: Number(it.qty), unitPrice: Number(it.unitPrice ?? 0) })),
  }
}

// Itens agrupados por peça e cor: "Camiseta adulto · Preto — P 5, M 10, G 8"
function agrupar(items: ItemPedido[]) {
  const m = new Map<string, { peca: string; cor: string | null; tams: string[]; qtd: number; valor: number }>()
  for (const it of items) {
    const k = `${it.productName}|${it.color ?? ""}`
    const g = m.get(k) ?? { peca: it.productName, cor: it.color, tams: [], qtd: 0, valor: 0 }
    g.tams.push(`${it.size ?? "único"} ${it.qty}`); g.qtd += Number(it.qty); g.valor += Number(it.unitPrice ?? 0) * Number(it.qty)
    m.set(k, g)
  }
  return [...m.values()]
}

export default function PedidosCliente({ pedidos, recarregar, catalogoHref = "/catalogo", onRepetido }: { pedidos: Pedido[]; recarregar: () => void; catalogoHref?: string; onRepetido?: (parcial: boolean) => void }) {
  const router = useRouter()
  const [aberto, setAberto] = useState<number | null>(pedidos[0]?.id ?? null)
  const [rec, setRec] = useState<SaleReceipt | null>(null)
  const [editando, setEditando] = useState<Pedido | null>(null)
  const [filtro, setFiltro] = useState<"todos" | "andando" | "concluidos">("todos")
  const [pagina, setPagina] = useState(1)
  const [aviso, setAviso] = useState("")

  const lista = useMemo(() => pedidos.filter((o) =>
    filtro === "todos" ? true : filtro === "andando" ? ["triagem", "em_separacao", "pronto"].includes(o.status) : o.status === "concluido"
  ), [pedidos, filtro])
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const visiveis = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const abertos = emAberto(pedidos).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())

  // "Pedir de novo": põe os mesmos itens no carrinho com o preço de hoje e só o que tem estoque.
  async function pedirDeNovo(o: Pedido) {
    setAviso("")
    try {
      const cat: PublicCatalogProduct[] = await fetch("/api/catalogo").then((r) => r.json())
      const porVariante = new Map(cat.flatMap((p) => p.variants.map((v) => [v.id, { p, v }] as const)))
      const novos: CartItem[] = []
      let fora = 0
      for (const it of o.items) {
        const achou = it.variantId ? porVariante.get(it.variantId) : undefined
        if (!achou || !achou.v.available) { fora++; continue }
        novos.push({ variantId: achou.v.id, productId: achou.p.id, productName: achou.p.name, color: achou.v.color, size: achou.v.size, price: achou.v.price, qty: Number(it.qty) })
      }
      if (!novos.length) { setAviso("As peças desse pedido estão sem estoque agora."); return }
      const atual = loadCart().filter((c) => !novos.some((n) => n.variantId === c.variantId))
      saveCart([...atual, ...novos])
      if (onRepetido) onRepetido(fora > 0)
      else router.push(`${catalogoHref}?repetido=${fora ? "parcial" : "1"}`)
    } catch {
      setAviso("Não deu pra montar agora. Tenta de novo.")
    }
  }

  if (!pedidos.length) {
    return (
      <div className="pt-vazio">
        <b>Você ainda não tem pedidos</b>
        <p>Escolhe as peças, monta a grade e manda. A gente te chama no WhatsApp pra fechar.</p>
        <a className="btn azul" href={catalogoHref}>Fazer meu primeiro pedido</a>
      </div>
    )
  }

  return (
    <div className="pt-pedidos">
      {abertos.length > 0 && (
        <div className="pt-prazo">
          <b>Pagamentos a prazo</b>
          {abertos.map((o) => {
            const late = vencido(o.dueDate!)
            return (
              <div key={o.id} className={`pt-prazo-lin ${late ? "late" : ""}`}>
                <span>Pedido {o.number}</span>
                <span>{late ? "Venceu em" : "Vence em"} {data(o.dueDate!)}</span>
                <strong>{brl(Number(o.totalValue ?? 0))}</strong>
              </div>
            )
          })}
        </div>
      )}

      <div className="tabs" role="group" aria-label="Filtrar pedidos">
        {([["todos", "Todos"], ["andando", "Andando"], ["concluidos", "Concluídos"]] as const).map(([k, n]) => (
          <button key={k} type="button" aria-pressed={filtro === k} onClick={() => { setFiltro(k); setPagina(1) }}>{n}</button>
        ))}
      </div>
      {aviso && <p className="erro">{aviso}</p>}

      {visiveis.length === 0 && <p className="obs">Nenhum pedido aqui.</p>}

      {visiveis.map((o) => {
        const cancelado = o.status === "cancelado"
        const passo = ETAPAS.findIndex((e) => e.st === o.status)
        const isOpen = aberto === o.id
        const pecas = o.items.reduce((s, i) => s + Number(i.qty), 0)
        return (
          <div key={o.id} className={`pt-ped ${isOpen ? "open" : ""}`}>
            <button type="button" className="pt-ped-top" onClick={() => setAberto(isOpen ? null : o.id)} aria-expanded={isOpen}>
              <div>
                <span className="pt-num">Pedido {o.number}</span>
                <span className="pt-meta">{data(o.createdAt)} · {pecas} {pecas === 1 ? "peça" : "peças"}</span>
              </div>
              <div className="pt-dir">
                <strong>{brl(Number(o.totalValue ?? 0))}</strong>
                <span className={`pt-st st-${o.status}`}>{cancelado ? "Cancelado" : ETAPAS[passo]?.nome ?? o.status}</span>
              </div>
            </button>

            {!cancelado && passo >= 0 && (
              <div className="pt-etapas" aria-label={`Etapa: ${ETAPAS[passo].nome}`}>
                {ETAPAS.map((e, i) => (
                  <div key={e.st} className={`pt-et ${i <= passo ? "feito" : ""} ${i === passo ? "agora" : ""}`}><i /><span>{e.nome}</span></div>
                ))}
              </div>
            )}

            {isOpen && (
              <div className="pt-ped-corpo">
                <div className="pt-itens">
                  {agrupar(o.items).map((g) => (
                    <div key={g.peca + g.cor} className="pt-it">
                      <span><b>{g.peca}</b>{g.cor ? ` · ${g.cor}` : ""}<small>{g.tams.join(" · ")}</small></span>
                      <span>{brl(g.valor)}</span>
                    </div>
                  ))}
                </div>
                {o.paymentMethod === "prazo" && <p className="obs">Prazo combinado com a loja: a data é confirmada na entrega.</p>}
                <div className="pt-acoes">
                  {!cancelado && <button type="button" className="btn azul" onClick={() => pedirDeNovo(o)}>Pedir de novo</button>}
                  {o.fiscalNoteStatus === "autorizada" && o.fiscalNoteId
                    ? <a className="btn borda" href={`/api/portal/notas/${o.fiscalNoteId}?type=pdf`} target="_blank" rel="noopener noreferrer">Ver nota fiscal</a>
                    : <button type="button" className="btn borda" onClick={() => setRec(recibo(o))}>Baixar recibo</button>}
                  {o.status === "em_separacao" && <button type="button" className="link" onClick={() => setEditando(o)}>Editar ou cancelar</button>}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {paginas > 1 && (
        <div className="pt-pag">
          <button type="button" disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior">‹</button>
          <span>{pagina} de {paginas}</span>
          <button type="button" disabled={pagina === paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">›</button>
        </div>
      )}

      {rec && <PdvReceiptModal receipt={rec} onClose={() => setRec(null)} autoPrint={false} />}
      {editando && (
        <OrderEditModal
          order={editando}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); recarregar() }}
          onCanceled={() => { setEditando(null); recarregar() }}
        />
      )}
    </div>
  )
}
