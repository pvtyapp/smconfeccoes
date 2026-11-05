"use client"

import "../site.css"
import { useCallback, useEffect, useState } from "react"
import DadosTab from "@/app/portal/DadosTab"
import NotaFiscalTab from "@/app/portal/NotaFiscalTab"
import PedidosCliente, { emAberto, type Pedido } from "./PedidosCliente"
import { brl } from "../util"
import CreditoIluminado from "../CreditoIluminado"
import { CardGrafico, ModalGrafico } from "./GraficoPedidos"
import SiteHome from "../SiteHome"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"

type Aba = "catalogo" | "pedidos" | "dados" | "notas"

// Página do cliente no visual do site novo (PIV 05/11). Regras de Meus Dados e
// Nota Fiscal continuam nas abas que já existiam; Meus Pedidos ganhou etapas,
// itens agrupados por peça/cor e "Pedir de novo".
export default function PortalSite({ name, products, dtfPreco }: { name: string; products: PublicCatalogProduct[]; dtfPreco: number | null }) {
  const [aba, setAba] = useState<Aba>("pedidos")
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null)
  const [erro, setErro] = useState(false)
  const [grafico, setGrafico] = useState(false)
  // "Pedir de novo": remonta a aba Catálogo com o pedido aberto
  const [repetido, setRepetido] = useState<{ v: "1" | "parcial"; n: number } | null>(null)
  const irCatalogo = () => { setAba("catalogo"); window.scrollTo({ top: 0, behavior: "smooth" }) }

  const carregar = useCallback(() => {
    fetch("/api/portal/orders")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setPedidos(Array.isArray(d) ? d : []); setErro(false) })
      .catch(() => { setPedidos([]); setErro(true) })
  }, [])
  useEffect(() => { carregar() }, [carregar])

  // "Completar meus dados" do pedido manda pra cá com #dados
  useEffect(() => { if (location.hash === "#dados") setAba("dados"); else if (location.hash === "#notas") setAba("notas"); else if (location.hash === "#catalogo") setAba("catalogo") }, [])

  const lista = pedidos ?? []
  const andando = lista.filter((o) => ["triagem", "em_separacao", "pronto"].includes(o.status)).length
  const prontos = lista.filter((o) => o.status === "pronto").length
  const abertos = emAberto(lista)
  const aPagar = abertos.reduce((s, o) => s + Number(o.totalValue ?? 0), 0)
  const venc = abertos.filter((o) => { const d = new Date(o.dueDate!); d.setHours(0, 0, 0, 0); const h = new Date(); h.setHours(0, 0, 0, 0); return d < h })
  const vencidoValor = venc.reduce((s, o) => s + Number(o.totalValue ?? 0), 0)

  async function sair() {
    await fetch("/api/portal/auth/logout", { method: "POST" }).catch(() => {})
    window.location.href = "/"
  }

  return (
    <div className="smsite pt">
      <nav className="nav solid">
        <div className="in">
          <a href="/" aria-label="SM Confecções, início"><img className="logo" src="/smsemfundo.png" alt="SM Confecções" /></a>
          <div className="links"><a href="/">Início</a><button type="button" className="lnk" onClick={irCatalogo}>Catálogo</button></div>
          <div className="direita">
            <button className="conta" type="button" onClick={sair}>Sair</button>
            <button className="bag" type="button" onClick={irCatalogo}>Fazer pedido</button>
          </div>
        </div>
      </nav>

      <main className="in pt-main">
        {/* aba Catálogo: só o catálogo na tela (PIV 05/11) */}
        {aba !== "catalogo" && (<>
        <span className="eye">Minha conta</span>
        <h1 className="pt-oi">Oi, {name.split(" ")[0]}.</h1>

        <div className="pt-resumo">
          <div className="pt-card">
            <small>Pedidos andando</small>
            <b>{pedidos === null ? "…" : andando}</b>
            <span>{prontos ? `${prontos} pronto${prontos > 1 ? "s" : ""} pra retirar` : "em análise ou separação"}</span>
          </div>
          {/* Sem nada a prazo (PIV 05/11): o card vira o mini gráfico de 30 dias; clicando abre o grande */}
          {pedidos !== null && abertos.length === 0 ? (
            <CardGrafico pedidos={lista} onAbrir={() => setGrafico(true)} />
          ) : (
            <div className={`pt-card ${vencidoValor > 0 ? "alerta" : ""}`}>
              <small>A pagar</small>
              <b>{pedidos === null ? "…" : brl(aPagar)}</b>
              <span>{vencidoValor > 0 ? `${brl(vencidoValor)} vencido` : "nada vencido"}</span>
            </div>
          )}
          <button type="button" className="pt-card novo" onClick={irCatalogo}>
            <small>Repor estoque</small>
            <b>Fazer pedido →</b>
            <span>monta a grade em 1 minuto</span>
          </button>
        </div>

        </>)}
        <div className="abas pt-abas" role="tablist">
          <button type="button" role="tab" aria-selected={aba === "catalogo"} onClick={() => setAba("catalogo")}>Catálogo</button>
          <button type="button" role="tab" aria-selected={aba === "pedidos"} onClick={() => setAba("pedidos")}>Meus pedidos</button>
          <button type="button" role="tab" aria-selected={aba === "dados"} onClick={() => setAba("dados")}>Meus dados</button>
          <button type="button" role="tab" aria-selected={aba === "notas"} onClick={() => setAba("notas")}>Nota fiscal</button>
        </div>

        <section className="pt-conteudo">
          {aba === "pedidos" && (
            pedidos === null ? <p className="obs">Carregando seus pedidos…</p>
              : erro ? <p className="erro">Não deu pra carregar seus pedidos. Atualiza a página.</p>
              : <PedidosCliente pedidos={lista} recarregar={carregar} catalogoHref="#catalogo"
                  onRepetido={(parcial) => { setRepetido((r) => ({ v: parcial ? "parcial" : "1", n: (r?.n ?? 0) + 1 })); irCatalogo() }} />
          )}
          {aba === "catalogo" && (
            <SiteHome key={repetido?.n ?? 0} variante="portal" products={products} dtfPreco={dtfPreco} clientName={name}
              repetido={repetido?.v ?? null} onVerPedidos={() => { carregar(); setAba("pedidos") }} />
          )}
          {aba === "dados" && <div className="pt-legado"><DadosTab /></div>}
          {aba === "notas" && <div className="pt-legado"><NotaFiscalTab /></div>}
        </section>
      </main>

      {grafico && <ModalGrafico pedidos={lista} onFechar={() => setGrafico(false)} />}

      <CreditoIluminado />

      <a className="zapflut" href="https://wa.me/5516992692363" target="_blank" rel="noopener noreferrer" aria-label="Chamar no WhatsApp">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="#06290f" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l2 .9c.3.1.5.2.5.3.1.2.1.8-.1 1.4Z" /></svg>
      </a>
    </div>
  )
}
