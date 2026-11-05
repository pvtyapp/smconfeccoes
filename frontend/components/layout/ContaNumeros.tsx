"use client"

import { useEffect } from "react"

// Números grandes dos cards contam até o valor (PIV 05/11: "motion, sem cara de MVP").
// Vale pra qualquer tela do painel sem mexer em cada uma: observa os textos em
// negrito pesado (.font-black) dentro da tela e, quando um vira número (R$, %, pç…),
// anima de 0 até ele mantendo o formato. Se o React trocar o texto no meio da
// animação, ela para e o valor novo é respeitado.
const RE = /^(R\$\s?|\+|-|−)?\s?(\d{1,3}(?:\.\d{3})+|\d+)(,\d+)?\s?(%|pç|peças|m|un)?$/

type Partes = { pre: string; num: number; dec: number; agrupa: boolean; suf: string }

function ler(txt: string): Partes | null {
  const t = txt.trim()
  if (t.length > 24) return null
  const m = t.match(RE)
  if (!m) return null
  const inteiro = m[2].replace(/\./g, "")
  const dec = m[3] ? m[3].length - 1 : 0
  const num = Number(inteiro + (m[3] ? "." + m[3].slice(1) : ""))
  if (!isFinite(num) || num === 0) return null
  return { pre: m[1] ?? "", num, dec, agrupa: m[2].includes(".") || num >= 10000, suf: m[4] ? (t.includes(" " + m[4]) ? " " + m[4] : m[4]) : "" }
}

function escreve(p: Partes, v: number) {
  const n = v.toLocaleString("pt-BR", { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec, useGrouping: p.agrupa })
  return `${p.pre}${p.pre === "R$" ? " " : ""}${n}${p.suf}`.replace("R$  ", "R$ ")
}

export default function ContaNumeros({ chave }: { chave: string }) {
  useEffect(() => {
    const raiz = document.querySelector(".pn-tela")
    if (!raiz) return
    const rodando = new WeakMap<HTMLElement, { alvo: string; escrito: string; raf: number }>()

    function anima(el: HTMLElement) {
      // só quando é um único nó de texto: escreve no nó do próprio React (trocar o
      // textContent criaria um nó novo e o React deixaria de atualizar esse número)
      const no = el.firstChild
      if (el.childNodes.length !== 1 || !no || no.nodeType !== Node.TEXT_NODE) return
      const alvo = el.textContent ?? ""
      const atual = rodando.get(el)
      if (atual && (alvo === atual.escrito || alvo === atual.alvo)) return
      if (atual) cancelAnimationFrame(atual.raf)
      const p = ler(alvo)
      if (!p) return
      const t0 = performance.now(), dur = 750
      const estado = { alvo, escrito: "", raf: 0 }
      rodando.set(el, estado)
      const passo = (t: number) => {
        // React trocou o texto por outro: para e deixa o novo
        if (estado.escrito && (el.firstChild !== no || el.textContent !== estado.escrito)) { rodando.delete(el); anima(el); return }
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3)
        estado.escrito = k < 1 ? escreve(p, p.num * e) : alvo
        ;(no as Text).data = estado.escrito
        if (k < 1) estado.raf = requestAnimationFrame(passo)
      }
      estado.raf = requestAnimationFrame(passo)
    }

    const candidatos = () => raiz.querySelectorAll<HTMLElement>("[class*='font-black']")
    const varre = () => candidatos().forEach((el) => { if (el.childElementCount === 0) anima(el) })
    varre()
    const mo = new MutationObserver((ms) => {
      for (const m of ms) {
        const alvo = (m.type === "characterData" ? m.target.parentElement : m.target) as HTMLElement | null
        if (alvo && alvo.childElementCount === 0 && alvo.className?.toString().includes("font-black")) anima(alvo)
        if (m.type === "childList") m.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement) n.querySelectorAll<HTMLElement>("[class*='font-black']").forEach((el) => { if (el.childElementCount === 0) anima(el) })
        })
      }
    })
    mo.observe(raiz, { subtree: true, childList: true, characterData: true })
    return () => mo.disconnect()
  }, [chave])
  return null
}
