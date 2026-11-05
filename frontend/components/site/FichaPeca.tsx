"use client"

import { useMemo, useState } from "react"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"
import type { CartItem } from "@/app/catalogo/cart"
import { colorToHex } from "@/app/catalogo/colorSwatch"
import { brl, coresDo, otim, tamanhosDo } from "./util"

// Ficha da peça com a GRADE: digita a quantidade de cada cor × tamanho de uma
// vez (jeito de comprar do atacado). Cor/tamanho sem estoque aparece "esgotado".
export default function FichaPeca({ product, atual, onSalvar }: {
  product: PublicCatalogProduct
  atual: CartItem[]
  onSalvar: (itens: CartItem[]) => void
}) {
  const cores = useMemo(() => coresDo(product), [product])
  const tamanhos = useMemo(() => tamanhosDo(product), [product])
  const variante = (cor: string | null, tam: string | null) => product.variants.find((v) => v.color === cor && v.size === tam)
  const [qtd, setQtd] = useState<Record<string, number>>(() => Object.fromEntries(atual.map((i) => [i.variantId, i.qty])))
  const fotos = product.images.length ? product.images.map((i) => i.url) : []
  const [foto, setFoto] = useState(0)
  const [verFotos, setVerFotos] = useState(false)
  const algumDisponivel = product.variants.some((v) => v.available)

  const total = Object.entries(qtd).reduce((s, [id, q]) => s + (product.variants.find((v) => v.id === id)?.price ?? 0) * q, 0)
  const pecas = Object.values(qtd).reduce((s, q) => s + q, 0)

  function salvar() {
    const itens: CartItem[] = Object.entries(qtd).filter(([, q]) => q > 0).map(([id, q]) => {
      const v = product.variants.find((x) => x.id === id)!
      return { variantId: v.id, productId: product.id, productName: product.name, color: v.color, size: v.size, price: v.price, qty: q }
    })
    onSalvar(itens)
  }

  return (
    <>
      {/* PIV 05/11: a grade tem que aparecer de cara, igual carrinho. Foto pequena no canto;
          fotos e tabela de medidas só abrem se a pessoa pedir. */}
      <div className="fcab">
        <button type="button" className="fthumb" onClick={() => setVerFotos((v) => !v)} aria-label="Ver fotos">
          {fotos[0] && <img src={otim(fotos[0], 256)} alt={product.name} />}
        </button>
        <div className="finfo">
          <span className="eye">{cores.length} {cores.length === 1 ? "cor" : "cores"} · {tamanhos[0]} a {tamanhos[tamanhos.length - 1]}</span>
          <h2>{product.name}</h2>
          <div className="pr">{brl(product.salePrice)}<small>a peça · sem pedido mínimo</small></div>
          {fotos.length > 0 && (
            <button className="link" type="button" onClick={() => setVerFotos((v) => !v)}>
              {verFotos ? "Esconder fotos" : fotos.length > 1 ? "Ver fotos e tabela de medidas" : "Ver foto"}
            </button>
          )}
        </div>
      </div>
      {verFotos && (
        <div className="gal fgal">
          <div className="main">{fotos[foto] && <img src={otim(fotos[foto], 1080)} alt={product.name} />}</div>
          {fotos.length > 1 && (
            <div className="th">
              {fotos.map((u, i) => (
                <button key={u + i} type="button" aria-pressed={i === foto} aria-label={`Foto ${i + 1}`} onClick={() => setFoto(i)}><img src={otim(u, 128)} alt="" /></button>
              ))}
            </div>
          )}
        </div>
      )}

      {!algumDisponivel ? (
        <div className="indisp">Sem estoque agora. Volta a abrir quando sair da produção.</div>
      ) : (
        <>
          <div className="gtit"><h3>Sua grade</h3><p>Digita quantas você quer em cada cor e tamanho.</p></div>
          <div className="gw">
            <table className="gr">
              <thead><tr><th>Cor</th>{tamanhos.map((t) => <th key={t}>{t}</th>)}<th>Total</th></tr></thead>
              <tbody>
                {cores.map((cor) => {
                  const linha = tamanhos.reduce((s, t) => { const v = variante(cor, t); return s + (v ? qtd[v.id] ?? 0 : 0) }, 0)
                  return (
                    <tr key={cor}>
                      <td><span className="c"><i style={{ background: colorToHex(cor) }} />{cor}</span></td>
                      {tamanhos.map((t) => {
                        const v = variante(cor, t)
                        if (!v || !v.available) return <td key={t}><span className="esg">esgotado</span></td>
                        const q = qtd[v.id] ?? 0
                        return (
                          <td key={t}>
                            <input
                              type="number" min={0} inputMode="numeric" aria-label={`${cor}, tamanho ${t}`}
                              className={q ? "has" : ""} value={q || ""}
                              onChange={(e) => setQtd((s) => ({ ...s, [v.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                            />
                          </td>
                        )
                      })}
                      <td className={`t ${linha ? "has" : ""}`}>{linha || "–"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="barra">
            <div className="v">{pecas} {pecas === 1 ? "peça" : "peças"} · {brl(total)}<small>NESTA PEÇA</small></div>
            <button className="btn azul" type="button" onClick={salvar} disabled={!pecas && !atual.length}>
              {atual.length ? "Atualizar pedido" : "Colocar no pedido"}
            </button>
          </div>
        </>
      )}
    </>
  )
}

export function FichaDtf({ preco, metrosAtual, onSalvar }: { preco: number; metrosAtual: number; onSalvar: (m: number) => void }) {
  const [m, setM] = useState(Math.max(1, metrosAtual || 1))
  return (
    <div className="fichatop">
      <div className="gal"><div className="main"><img src="/site/dtf.jpg" alt="Rolo de DTF Têxtil" /></div></div>
      <div className="finfo">
        <span className="eye">DTF Têxtil</span>
        <h2>DTF Têxtil 60 cm</h2>
        <p className="desc">Você recebe o filme com a estampa pronta e aplica na peça. A arte você manda no WhatsApp depois de fazer o pedido.</p>
        <div className="pr">{brl(preco)}<small>o metro</small></div>
        <div className="fld">
          <label htmlFor="dtf-metros">Quantos metros?</label>
          <div className="metros">
            <button type="button" aria-label="Menos um metro" onClick={() => setM((x) => Math.max(1, x - 1))}>−</button>
            <input id="dtf-metros" type="number" min={1} inputMode="numeric" value={m} onChange={(e) => setM(Math.max(1, parseInt(e.target.value) || 1))} />
            <button type="button" aria-label="Mais um metro" onClick={() => setM((x) => x + 1)}>+</button>
          </div>
        </div>
        <p className="obs">Total: <b>{brl(m * preco)}</b></p>
        <button className="btn azul grande" type="button" onClick={() => onSalvar(m)}>Colocar no pedido</button>
      </div>
    </div>
  )
}
