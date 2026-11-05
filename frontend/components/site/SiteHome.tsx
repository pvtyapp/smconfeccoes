"use client"

import "./site.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"
import { loadCart, saveCart, type CartItem } from "@/app/catalogo/cart"
import FichaPeca, { FichaDtf } from "./FichaPeca"
import PedidoDrawer from "./PedidoDrawer"
import AcessoFlow from "./AcessoFlow"
import { brl, capaDo, coresDo, medidasDo, tamanhosDo } from "./util"

const WA = "https://wa.me/5516992692363?text=" + encodeURIComponent("Olá! Vim pelo site da SM Confecções.")
const DTF_KEY = "sm_dtf_metros"
const LETREIRO = ["Sem pedido mínimo", "Nota fiscal em todo pedido", "Reposição todo dia", "Preço na tela"]

type Painel = { tipo: "peca"; id: string } | { tipo: "dtf" } | { tipo: "pedido" } | { tipo: "entrar" } | null

// Home nova da SM (PIV 05/11): estúdio claro com o vídeo da torre de camisetas,
// letreiro, fita métrica que desce costurando as seções, peças com grade e o
// pedido que fecha no WhatsApp.
// variante "catalogo" (/catalogo, usado também por quem está logado): mesmas peças,
// mesma grade e mesmo pedido, sem o vídeo e as seções de apresentação.
export default function SiteHome({ products, dtfPreco, clientName, variante = "home" }: {
  products: PublicCatalogProduct[]
  dtfPreco: number | null
  clientName: string | null
  variante?: "home" | "catalogo"
}) {
  const home = variante === "home"
  const [cart, setCart] = useState<CartItem[]>([])
  const [dtfMetros, setDtfMetros] = useState(0)
  const [painel, setPainel] = useState<Painel>(null)
  const [logado, setLogado] = useState<string | null>(clientName)
  const [toast, setToast] = useState("")
  const [bump, setBump] = useState(false)
  const [solid, setSolid] = useState(false)
  const [abaMedida, setAbaMedida] = useState(0)
  const [aviso, setAviso] = useState("")

  useEffect(() => {
    setCart(loadCart())
    try { setDtfMetros(Number(localStorage.getItem(DTF_KEY)) || 0) } catch { /* sem localStorage */ }
    // veio do "Pedir de novo" da página do cliente: abre o pedido já montado
    const rep = new URLSearchParams(location.search).get("repetido")
    if (rep) {
      setPainel({ tipo: "pedido" })
      setToast(rep === "parcial" ? "Montamos o pedido de novo. Algumas peças estão sem estoque e ficaram de fora." : "Montamos o pedido de novo. Confere e manda.")
      window.setTimeout(() => setToast(""), 4000)
      history.replaceState(null, "", location.pathname)
    }
  }, [])

  const salvaCart = useCallback((c: CartItem[]) => { setCart(c); saveCart(c); setBump(false); requestAnimationFrame(() => setBump(true)) }, [])
  const salvaDtf = useCallback((m: number) => { setDtfMetros(m); try { localStorage.setItem(DTF_KEY, String(m)) } catch { /* ok */ }; setBump(false); requestAnimationFrame(() => setBump(true)) }, [])
  const avisar = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(""), 2600) }, [])

  const pecasNoPedido = cart.reduce((s, i) => s + i.qty, 0)
  const capas = useMemo(() => Object.fromEntries(products.map((p) => [p.id, capaDo(p)])), [products])
  const comMedida = useMemo(() => products.filter((p) => medidasDo(p)), [products])

  // trava a rolagem com painel aberto + Esc fecha
  useEffect(() => {
    document.body.style.overflow = painel ? "hidden" : ""
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPainel(null) }
    addEventListener("keydown", esc)
    return () => { removeEventListener("keydown", esc); document.body.style.overflow = "" }
  }, [painel])

  // ── movimento: topo sólido, letreiro com a rolagem, zoom do vídeo, fita métrica ──
  const raiz = useRef<HTMLDivElement>(null)
  const letreiro = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const fitaSvg = useRef<SVGSVGElement>(null)
  const fitaLen = useRef(0)

  useEffect(() => {
    const red = matchMedia("(prefers-reduced-motion: reduce)").matches
    const svg = fitaSvg.current, root = raiz.current!
    const q = <T extends Element>(s: string) => svg!.querySelector(s) as T

    function desenha() {
      if (!svg || !fitaLen.current) return
      const H = root.scrollHeight
      const k = red ? 1 : Math.min(1, Math.max(0.08, (scrollY + innerHeight * 0.85) / H))
      q<SVGPathElement>(".rev").style.strokeDashoffset = String(fitaLen.current * (1 - k))
    }

    function monta() {
      if (!svg) return
      const W = root.clientWidth, H = root.scrollHeight, mob = W < 700, TW = mob ? 14 : 34
      svg.setAttribute("width", String(W)); svg.setAttribute("height", String(H)); svg.setAttribute("viewBox", `0 0 ${W} ${H}`)
      svg.style.height = H + "px"
      const top = root.getBoundingClientRect().top + scrollY
      const y = (id: string) => { const el = document.getElementById(id); return el ? el.getBoundingClientRect().top + scrollY - top : 0 }
      const hb = (document.getElementById("topo")?.offsetHeight ?? 600)
      // corre pela margem e só atravessa no respiro do topo de cada seção (cruzar na diagonal cobre os títulos)
      const mg = (W - Math.min(1240, W)) / 2
      const L = mob ? 8 : Math.max(TW / 2 + 6, mg / 2 + 8), R = W - L, pad = mob ? 36 : 60
      // nasce escondida embaixo do letreiro (z-index maior) e desce pelas seções: nunca passa na abertura (PIV 05/11)
      const pts: [number, number][] = [[L, hb + 5], [L, y("pecas") + pad]]
      let lado = L
      for (const id of ["valor", "como", "medida", "dtf", "fabrica"]) {
        if (!document.getElementById(id)) continue
        pts.push([lado, y(id) + 10]); lado = lado === L ? R : L; pts.push([lado, y(id) + pad + 20])
      }
      pts.push([lado, H - 120])
      let d = `M${pts[0][0]},${pts[0][1]}`
      for (let i = 1; i < pts.length; i++) { const [a, b] = pts[i - 1], [c, e] = pts[i], my = (b + e) / 2; d += ` C${a},${my} ${c},${my} ${c},${e}` }
      svg.querySelectorAll("path").forEach((p) => p.setAttribute("d", d))
      const corpo = q<SVGPathElement>(".corpo")
      fitaLen.current = corpo.getTotalLength()
      corpo.style.strokeWidth = String(TW)
      const t1 = q<SVGPathElement>(".t1"), t2 = q<SVGPathElement>(".t2")
      t1.style.strokeWidth = String(TW * 0.32); t1.style.strokeDasharray = "1.4 8.6"
      t2.style.strokeWidth = String(TW * 0.55); t2.style.strokeDasharray = "1.8 48.2"
      // número a cada 50px (a régua tem 1 cm = 10px)
      const g = q<SVGGElement>(".nums"); const step = 50; let html = ""
      for (let i = 1; i < Math.floor(fitaLen.current / step); i++) {
        const p = corpo.getPointAtLength(i * step), pa = corpo.getPointAtLength(Math.min(fitaLen.current, i * step + 1))
        const ang = Math.atan2(pa.y - p.y, pa.x - p.x) * 180 / Math.PI
        html += `<text x="${p.x}" y="${p.y}" transform="rotate(${ang} ${p.x} ${p.y}) translate(0 ${TW * 0.42})" text-anchor="middle" style="font-size:${mob ? 8 : 11}px">${i * 5}</text>`
      }
      g.innerHTML = html
      const rev = q<SVGPathElement>(".rev"); rev.style.strokeWidth = String(TW * 3); rev.style.strokeDasharray = String(fitaLen.current)
      desenha()
    }

    function rola() {
      setSolid(scrollY > 30)
      desenha()
      if (red) return
      const l = letreiro.current
      if (l) l.style.transform = `translateX(${-((scrollY * 0.45) % (l.scrollWidth / 3))}px)`
      if (video.current) video.current.style.transform = `scale(${1 + Math.min(scrollY, 800) * 0.00025})`
    }

    // revelar ao rolar
    let io: IntersectionObserver | null = null
    if (!red && "IntersectionObserver" in window) {
      io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.remove("pre"); io!.unobserve(e.target) } }), { rootMargin: "0px 0px -8% 0px" })
      root.querySelectorAll(".rv").forEach((el) => {
        if (el.getBoundingClientRect().top > innerHeight) {
          el.classList.add("pre")
          const irmaos = [...(el.parentElement?.children ?? [])].filter((x) => x.classList.contains("rv"))
          ;(el as HTMLElement).style.transitionDelay = Math.min(irmaos.indexOf(el), 5) * 0.08 + "s"
          io!.observe(el)
        }
      })
    }

    let t: number | undefined
    const refaz = () => { window.clearTimeout(t); t = window.setTimeout(() => { monta(); rola() }, 120) }
    const ro = new ResizeObserver(refaz)
    ro.observe(root)
    addEventListener("scroll", rola, { passive: true })
    if (document.fonts) document.fonts.ready.then(refaz)
    refaz()
    if (video.current) { video.current.muted = true; if (red) video.current.pause(); else video.current.play().catch(() => {}) }
    return () => { removeEventListener("scroll", rola); ro.disconnect(); io?.disconnect(); window.clearTimeout(t) }
  }, [])

  const abrirPeca = (id: string) => setPainel({ tipo: "peca", id })
  const peca = painel?.tipo === "peca" ? products.find((p) => p.id === painel.id) : null
  const medida = comMedida[abaMedida] ?? null

  return (
    <div className="smsite" ref={raiz}>
      {home && <svg className="fita" ref={fitaSvg} aria-hidden="true">
        <defs><mask id="smFitaMask" maskUnits="userSpaceOnUse"><path className="rev" fill="none" stroke="#fff" strokeLinecap="round" /></mask></defs>
        <g mask="url(#smFitaMask)"><path className="corpo" /><path className="tick t1" /><path className="tick t2" /><g className="nums" /></g>
      </svg>}

      <nav className={`nav ${solid || !home ? "solid" : ""}`}>
        <div className="in">
          <a href={home ? "#topo" : "/"} aria-label="SM Confecções, início"><img className="logo" src="/smsemfundo.png" alt="SM Confecções" /></a>
          {home
            ? <div className="links"><a href="#pecas">Peças</a><a href="#valor">Por que a SM</a>{dtfPreco !== null && <a href="#dtf">DTF</a>}<a href="#como">Como funciona</a></div>
            : <div className="links"><a href="/">Início</a>{logado && <a href="/portal">Meus pedidos</a>}</div>}
          <div className="direita">
            {logado
              ? <a className="conta" href="/portal"><span className="so-grande">Minha </span>conta</a>
              : <button className="conta" type="button" onClick={() => setPainel({ tipo: "entrar" })}>Entrar</button>}
            <button className={`bag ${bump ? "bump" : ""}`} type="button" onClick={() => setPainel({ tipo: "pedido" })} aria-label="Abrir seu pedido">
              Pedido <b>{pecasNoPedido}{dtfMetros ? ` + ${dtfMetros}m` : ""}</b>
            </button>
          </div>
        </div>
      </nav>

      {home && (<>
      <header className="hero" id="topo">
        <div className="media" aria-hidden="true">
          <img className="poster" src="/site/torre.jpg" alt="" />
          <video ref={video} src="/site/torre.mp4" poster="/site/torre.jpg" autoPlay muted loop playsInline preload="auto" />
        </div>
        <div className="in">
          <span className="loc">Fábrica em Franca/SP · atacado</span>
          <h1>
            <span className="ln" style={{ color: "var(--navy)" }}><i>Mesma medida</i></span>
            <span className="ln" style={{ color: "var(--navy)" }}><i style={{ animationDelay: ".12s" }}>em todo</i></span>
            <span className="ln"><i style={{ animationDelay: ".24s" }}>pedido.</i></span>
          </h1>
          <p className="sub">Camiseta, cropped, moletom e DTF Têxtil direto da fábrica. Preço na tela: você monta a grade e a gente te chama no WhatsApp pra fechar.</p>
          <div className="ctas">
            <a className="btn azul" href="#pecas">Ver peças e preços</a>
            {logado
              ? <a className="btn borda" href="/portal">Meus pedidos</a>
              : <button className="btn borda" type="button" onClick={() => setPainel({ tipo: "entrar" })}>Já compro com a SM</button>}
          </div>
        </div>
      </header>

      <div className="letreiro" aria-label={LETREIRO.join(", ")}>
        <div className="run" ref={letreiro}>
          {[0, 1, 2].flatMap((k) => [...LETREIRO, ...(dtfPreco ? [`DTF ${brl(dtfPreco)} o metro`] : [])].map((t, i) => <span key={`${k}-${i}`} className={i % 2 ? "vaz" : ""}>{t}</span>))}
        </div>
      </div>

      </>)}

      <main>
        <section className={`sec ${home ? "" : "catalogo"}`} id="pecas">
          <div className="in">
            {home ? (<>
              <span className="eye rv">Peças · preço por peça</span>
              <h2 className="rv" style={{ marginTop: 14 }}>Escolhe a peça.<br /><span>Monta a grade.</span></h2>
            </>) : (<>
              <span className="eye">{logado ? `Oi, ${logado.split(" ")[0]}! · ` : ""}Preço por peça · sem pedido mínimo</span>
              <h2 style={{ marginTop: 14 }}>Catálogo.<br /><span>Toca na peça e monta a grade.</span></h2>
            </>)}
            <div className="pecas">
              {products.map((p, idx) => {
                const tams = tamanhosDo(p), cores = coresDo(p), disponivel = p.variants.some((v) => v.available)
                return (
                  <button key={p.id} className={`card ${home ? "rv" : ""} ${idx < 2 ? "lg" : ""}`} type="button" onClick={() => abrirPeca(p.id)}>
                    <div className="ph">
                      {capas[p.id] && <img src={capas[p.id]!} alt={p.name} loading="lazy" />}
                      {!disponivel && <span className="off">Sem estoque agora</span>}
                      {disponivel && <span className="mais">Montar grade</span>}
                    </div>
                    <div className="bd">
                      <div><h3>{p.name}</h3><div className="info">{cores.length} {cores.length === 1 ? "cor" : "cores"}{tams.length ? ` · ${tams[0]} a ${tams[tams.length - 1]}` : ""}</div></div>
                      <div className="pr">{brl(p.salePrice)}<small>a peça</small></div>
                    </div>
                  </button>
                )
              })}
              {dtfPreco !== null && (
                <button className={`card ${home ? "rv" : ""}`} type="button" onClick={() => setPainel({ tipo: "dtf" })}>
                  <div className="ph"><img src="/site/dtf.jpg" alt="DTF Têxtil" loading="lazy" /><span className="mais">Pedir metros</span></div>
                  <div className="bd"><div><h3>DTF Têxtil 60 cm</h3><div className="info">60 cm de largura</div></div><div className="pr">{brl(dtfPreco)}<small>o metro</small></div></div>
                </button>
              )}
            </div>
          </div>
        </section>

        {home && (<>
        <section className="sec valor" id="valor">
          <div className="in grid">
            <div className="voa rv"><img src="/site/voando.jpg" alt="Camisetas coloridas" /></div>
            <div className="txt">
              <span className="eye rv">Por que a SM</span>
              <h2 className="rv">Fábrica de verdade.<br /><span>Pedido sem susto.</span></h2>
              <ul className="valores rv">
                <li><b>Produção própria</b><span>Corte e costura aqui dentro, em Franca.</span></li>
                <li><b>A mesma grade de tamanhos sempre</b><span>O G desse pedido é o G do próximo.</span></li>
                <li><b>Peças revisadas</b><span>Cada peça é conferida antes de sair.</span></li>
                <li><b>Estoque renovado todos os dias</b><span>Todo dia sai peça da produção pro estoque.</span></li>
              </ul>
              <a className="btn azul rv" href="#pecas">Montar meu pedido</a>
            </div>
          </div>
        </section>

        <section className="sec como" id="como">
          <div className="in">
            <span className="eye rv">Simples assim</span>
            <h2 className="rv" style={{ marginTop: 14 }}>Como funciona<br /><span>seu pedido.</span></h2>
            <div className="passos">
              <div className="passo rv"><span className="cm">0 CM</span><span className="n">01</span><h3>Monta a grade</h3><p>Escolhe a peça e digita quantas de cada cor e tamanho.</p></div>
              <div className="passo rv"><span className="cm">25 CM</span><span className="n">02</span><h3>Manda o pedido</h3><p>Entra com seu WhatsApp e senha. Primeira vez? Cria sua conta na hora.</p></div>
              <div className="passo rv"><span className="cm">50 CM</span><span className="n">03</span><h3>A gente te chama</h3><p>Pagamento e frete combinados direto no WhatsApp.</p></div>
              <div className="passo rv"><span className="cm">75 CM</span><span className="n">04</span><h3>Retira ou recebe</h3><p>Na fábrica, em Franca, ou onde você estiver.</p></div>
            </div>
            <p className="aviso rv">Primeira vez? Cria sua conta na hora com seu WhatsApp e já manda o pedido.</p>
          </div>
        </section>

        <section className="sec medida" id="medida">
          <div className="in grid">
            <div className={`foto rv ${medida ? "tabela" : ""}`}>
              <img src={medida ? medidasDo(medida)! : "/site/leque.jpg"} alt={medida ? `Tabela de medidas: ${medida.name}` : "Camisetas com fita métrica"} />
            </div>
            <div className="txt">
              <span className="eye rv">Medidas</span>
              <h2 className="rv">O G desse lote<br /><span>é o G do próximo.</span></h2>
              <p className="rv">Mesmo molde, mesma gradação, corte e costura aqui dentro. Confere a medida de cada peça.</p>
              {comMedida.length > 0 && (
                <div className="tabs rv" role="group" aria-label="Escolha a peça">
                  {comMedida.map((p, i) => <button key={p.id} type="button" aria-pressed={i === abaMedida} onClick={() => setAbaMedida(i)}>{p.name}</button>)}
                </div>
              )}
            </div>
          </div>
        </section>

        {dtfPreco !== null && (
          <section className="sec dtf" id="dtf">
            <div className="in box">
              <div className="txt">
                <span className="eye rv">DTF Têxtil 60 cm</span>
                <h2 className="rv">A estampa sai<br /><span>da mesma fábrica.</span></h2>
                <p className="rv">Filme de 60 cm, vendido por metro. Você aplica na camiseta que já conhece a medida.</p>
                <div className="preco rv">{brl(dtfPreco)}<small>o metro</small></div>
                <button className="btn azul rv" type="button" onClick={() => setPainel({ tipo: "dtf" })}>Pedir metros</button>
              </div>
              <div className="foto rv"><img src="/site/dtf.jpg" alt="Rolo de DTF Têxtil com estampas e camiseta estampada" /></div>
            </div>
          </section>
        )}

        <section className="sec fab" id="fabrica">
          <div className="in">
            <span className="eye rv">A fábrica</span>
            <h2 className="rv" style={{ marginTop: 14 }}>Fábrica de verdade,<br /><span>em Franca.</span></h2>
            <div className="fim">
              <div className="c rv">
                <b>Av. Santa Cruz, 3088</b>
                <p>Vila Santa Cruz, Franca/SP. Em frente ao Condomínio Franca Garden, do lado da entrada do estacionamento do Tiaozinho Supermercado.</p>
                <a className="btn borda" href="https://www.google.com/maps/search/?api=1&query=Av.+Santa+Cruz,+3088+Franca+SP" target="_blank" rel="noopener noreferrer">Como chegar</a>
              </div>
              <div className="c zap rv">
                <b>Ficou dúvida?</b>
                <p>(16) 99269-2363</p>
                <a className="btn wa" href={WA} target="_blank" rel="noopener noreferrer">Chamar no WhatsApp</a>
              </div>
            </div>
          </div>
        </section>
        </>)}
      </main>

      <footer>
        <div className="in">
          <img src="/smsemfundo.png" alt="SM Confecções" />
          <div className="lk">
            <a href="https://instagram.com/smconfeccoes.franca" target="_blank" rel="noopener noreferrer">@smconfeccoes.franca</a>
            <a href="/portal">Minha conta</a>
            <a href="/login">Área administrativa</a>
          </div>
          <span>SM Confecções · Franca/SP</span>
        </div>
      </footer>

      <a className="zapflut" href={WA} target="_blank" rel="noopener noreferrer" aria-label="Chamar no WhatsApp">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="#06290f" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l2 .9c.3.1.5.2.5.3.1.2.1.8-.1 1.4Z" /></svg>
      </a>

      <div className={`ov ${painel ? "on" : ""}`} onClick={() => setPainel(null)} />

      <aside className={`sheet ${painel?.tipo === "peca" || painel?.tipo === "dtf" ? "on" : ""}`} aria-hidden={!(painel?.tipo === "peca" || painel?.tipo === "dtf")}>
        <div className="top"><b>{painel?.tipo === "dtf" ? "DTF Têxtil" : "Peça"}</b><button className="x" type="button" onClick={() => setPainel(null)} aria-label="Fechar">×</button></div>
        <div className="sc">
          {peca && (
            <FichaPeca key={peca.id} product={peca} atual={cart.filter((i) => i.productId === peca.id)}
              onSalvar={(novos) => {
                salvaCart([...cart.filter((i) => i.productId !== peca.id), ...novos])
                setPainel(null)
                const n = novos.reduce((s, i) => s + i.qty, 0)
                avisar(n ? `${n} ${n === 1 ? "peça" : "peças"} de ${peca.name.toLowerCase()} no pedido` : "Tirado do pedido")
              }} />
          )}
          {painel?.tipo === "dtf" && dtfPreco !== null && (
            <FichaDtf preco={dtfPreco} metrosAtual={dtfMetros} onSalvar={(m) => { salvaDtf(m); setPainel(null); avisar(`${m} m de DTF no pedido`) }} />
          )}
        </div>
      </aside>

      <aside className={`sheet estreito ${painel?.tipo === "pedido" || painel?.tipo === "entrar" ? "on" : ""}`} aria-hidden={!(painel?.tipo === "pedido" || painel?.tipo === "entrar")}>
        <div className="top"><b>{painel?.tipo === "entrar" ? "Entrar" : "Seu pedido"}</b><button className="x" type="button" onClick={() => { setPainel(null); setAviso("") }} aria-label="Fechar">×</button></div>
        <div className="sc">
          {painel?.tipo === "pedido" && (
            <PedidoDrawer
              itens={cart} dtfMetros={dtfMetros} dtfPreco={dtfPreco} capas={capas} logado={logado}
              onLogou={setLogado}
              onTirar={(pid) => { if (pid === "dtf") salvaDtf(0); else salvaCart(cart.filter((i) => i.productId !== pid)) }}
              onLimpar={() => { salvaCart([]); salvaDtf(0) }}
              onVerPecas={() => { setPainel(null); document.getElementById("pecas")?.scrollIntoView({ behavior: "smooth" }) }}
            />
          )}
          {painel?.tipo === "entrar" && (aviso ? (
            <>
              <p className="tit">Cadastro recebido</p>
              <p className="obs">{aviso}</p>
              <button className="btn azul grande" type="button" onClick={() => { setPainel(null); setAviso("") }}>Ok</button>
            </>
          ) : (
            <AcessoFlow onFim={(r) => {
              if (r.tipo === "logado") { setLogado(r.name); setPainel(null); avisar(`Oi, ${r.name.split(" ")[0]}! Você entrou.`) }
              else setAviso("Nossa equipe confere seu cadastro e te avisa no WhatsApp assim que liberar.")
            }} />
          ))}
        </div>
      </aside>

      <div className={`toast ${toast ? "on" : ""}`} role="status">{toast}</div>
    </div>
  )
}
