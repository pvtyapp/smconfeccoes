"use client"

import { useState } from "react"
import Link from "next/link"
import type { CartItem } from "@/app/catalogo/cart"
import AcessoFlow, { type AcessoResultado } from "./AcessoFlow"
import { brl } from "./util"

type Etapa = "lista" | "entrar" | "enviando" | "fim" | "faltaDados"

// Seu pedido → Mandar. Quem já está logado manda direto; quem não está entra
// ou cria a conta no meio do caminho, sem perder o carrinho. Com a trava de
// aprovação ligada, o pedido de quem é novo vai junto do cadastro pra aprovar.
export default function PedidoDrawer({ itens, dtfMetros, dtfPreco, capas, logado, onLogou, onTirar, onLimpar, onVerPecas }: {
  itens: CartItem[]
  dtfMetros: number
  dtfPreco: number | null
  capas: Record<string, string | null>
  logado: string | null
  onLogou: (name: string) => void
  onTirar: (productId: string) => void
  onLimpar: () => void
  onVerPecas: () => void
}) {
  const [etapa, setEtapa] = useState<Etapa>("lista")
  const [erro, setErro] = useState("")
  const [faltam, setFaltam] = useState<string[]>([])
  const [fim, setFim] = useState<{ novo: boolean; numeros: string[]; pecas: number; metros: number; total: number } | null>(null)

  const pecas = itens.reduce((s, i) => s + i.qty, 0)
  const total = itens.reduce((s, i) => s + i.price * i.qty, 0) + (dtfPreco ? dtfPreco * dtfMetros : 0)
  const porProduto = new Map<string, CartItem[]>()
  for (const i of itens) porProduto.set(i.productId, [...(porProduto.get(i.productId) ?? []), i])

  async function enviarLogado() {
    setErro(""); setEtapa("enviando")
    const numeros: string[] = []
    try {
      if (itens.length) {
        const res = await fetch("/api/portal/checkout", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: itens.map((i) => ({ variantId: i.variantId, qty: i.qty })) }),
        })
        const data = await res.json()
        if (res.status === 401) { setEtapa("entrar"); return }
        if (!res.ok) {
          if (Array.isArray(data.missing) && data.missing.length) { setFaltam(data.missing); setEtapa("faltaDados"); return }
          setErro(data.error ?? "Não deu pra mandar o pedido."); setEtapa("lista"); return
        }
        numeros.push(data.number)
      }
      if (dtfMetros > 0) {
        const res = await fetch("/api/portal/dtf-pedido", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metros: dtfMetros }),
        })
        const data = await res.json()
        if (!res.ok) { setErro(data.error ?? "Não deu pra mandar o pedido de DTF."); setEtapa("lista"); return }
        numeros.push(data.number)
      }
      setFim({ novo: false, numeros, pecas, metros: dtfMetros, total })
      onLimpar()
      setEtapa("fim")
    } catch {
      setErro("Sem internet? Tenta de novo."); setEtapa("lista")
    }
  }

  function aoEntrar(r: AcessoResultado) {
    if (r.tipo === "logado") { onLogou(r.name); enviarLogado() }
    else { setFim({ novo: true, numeros: [], pecas, metros: dtfMetros, total }); onLimpar(); setEtapa("fim") }
  }

  if (etapa === "fim" && fim) {
    return (
      <div className="ok">
        <span className="sel">✓</span>
        {fim.novo ? (
          <>
            <p className="tit">Pedido recebido!</p>
            <p className="obs">Seu cadastro vai ser conferido pela nossa equipe. Seu pedido ficou guardado e entra na fila assim que aprovar. A gente te avisa no WhatsApp.</p>
            <Link className="btn navy" href="/">Voltar pro site</Link>
          </>
        ) : (
          <>
            <p className="tit">Pedido enviado!</p>
            <p className="obs">
              Recebemos {fim.numeros.join(" e ")}
              {fim.pecas ? ` com ${fim.pecas} ${fim.pecas === 1 ? "peça" : "peças"}` : ""}
              {fim.metros ? `${fim.pecas ? " e" : " com"} ${fim.metros} m de DTF` : ""}. Já já a gente te chama no WhatsApp pra combinar pagamento e frete.
            </p>
            <a className="btn navy" href="/portal">Ver meus pedidos</a>
          </>
        )}
      </div>
    )
  }

  if (etapa === "entrar") {
    return (
      <>
        <span className="passoN">Falta pouco: entra ou cria sua conta</span>
        <AcessoFlow carrinho={{ itens: itens.map((i) => ({ variantId: i.variantId, qty: i.qty })), dtfMetros }} onFim={aoEntrar} />
        {erro && <p className="erro">{erro}</p>}
        <button className="link" type="button" onClick={() => setEtapa("lista")}>← Voltar pro pedido</button>
      </>
    )
  }

  if (etapa === "faltaDados") {
    return (
      <>
        <p className="tit">Falta um dado seu</p>
        <p className="obs">Pra fechar o pedido com nota, precisamos de: <b>{faltam.join(", ")}</b>.</p>
        <p className="obs">Seu pedido continua guardado aqui. Completa e volta pra mandar.</p>
        <a className="btn azul grande" href="/portal#dados">Completar meus dados</a>
        <button className="link" type="button" onClick={() => setEtapa("lista")}>← Voltar pro pedido</button>
      </>
    )
  }

  if (!itens.length && !dtfMetros) {
    return (
      <div className="vazio">
        <b>Seu pedido tá vazio</b>
        <p>Escolhe uma peça e digita a grade.</p>
        <button className="btn azul" type="button" onClick={onVerPecas}>Ver peças</button>
      </div>
    )
  }

  return (
    <>
      {[...porProduto.entries()].map(([pid, linhas]) => {
        const porCor = new Map<string, string[]>()
        for (const l of linhas) porCor.set(l.color ?? "", [...(porCor.get(l.color ?? "") ?? []), `${l.size ?? ""}: ${l.qty}`])
        return (
          <div className="lin" key={pid}>
            {capas[pid] ? <img src={capas[pid]!} alt="" /> : <span />}
            <div>
              <b>{linhas[0].productName}</b>
              <div className="gd">{[...porCor.entries()].map(([cor, l]) => <span key={cor}>{cor ? `${cor} · ` : ""}{l.join(", ")}</span>)}</div>
              <button className="rm" type="button" onClick={() => onTirar(pid)}>tirar</button>
            </div>
            <div className="vv">{brl(linhas.reduce((s, l) => s + l.price * l.qty, 0))}</div>
          </div>
        )
      })}
      {dtfMetros > 0 && (
        <div className="lin">
          <img src="/site/dtf.jpg" alt="" />
          <div><b>DTF Têxtil 60 cm</b><div className="gd"><span>{dtfMetros} m</span></div><button className="rm" type="button" onClick={() => onTirar("dtf")}>tirar</button></div>
          <div className="vv">{dtfPreco ? brl(dtfPreco * dtfMetros) : ""}</div>
        </div>
      )}
      <div className="tot"><span>{pecas} {pecas === 1 ? "peça" : "peças"}{dtfMetros ? ` + ${dtfMetros} m DTF` : ""}</span><b>{brl(total)}</b></div>
      <p className="obs">Depois de mandar, a gente te chama no WhatsApp pra combinar pagamento e frete.</p>
      {erro && <p className="erro">{erro}</p>}
      <button className="btn azul grande" type="button" disabled={etapa === "enviando"}
        onClick={() => (logado ? enviarLogado() : setEtapa("entrar"))}>
        {etapa === "enviando" ? "Mandando…" : "Mandar pedido"}
      </button>
    </>
  )
}
