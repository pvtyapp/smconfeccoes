// "+N" sai do botão Adicionar, faz um arco até o contador do carrinho e o
// contador dá um pulo — mesmo efeito do catálogo do Vision Commerce, nas cores
// do SM. Quem prefere menos movimento (prefers-reduced-motion) só vê o pulo.
// `badge` é getter: no 1º item o contador ainda não existe na hora do clique,
// só aparece depois que o carrinho re-renderiza.
export function flyToCart(qty: number, origem: DOMRect | undefined, alvoEl: HTMLElement | null, badge: () => HTMLElement | null) {
  const pular = () => badge()?.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.6)" }, { transform: "scale(1)" }],
    { duration: 350, easing: "ease-out" },
  )
  const alvo = alvoEl?.getBoundingClientRect()
  const semMovimento = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  if (!alvo || !origem || semMovimento) { setTimeout(pular, 50); return }

  const el = document.createElement("div")
  el.textContent = `+${qty}`
  el.setAttribute("aria-hidden", "true")
  Object.assign(el.style, {
    position: "fixed", zIndex: "80",
    left: `${origem.left + origem.width / 2 - 20}px`, top: `${origem.top + origem.height / 2 - 16}px`,
    width: "40px", height: "32px", borderRadius: "999px", background: "#4361EE", color: "#fff",
    font: "800 14px/32px system-ui, sans-serif", textAlign: "center",
    boxShadow: "0 6px 20px rgba(67,97,238,.45)", pointerEvents: "none",
  })
  document.body.appendChild(el)
  const dx = alvo.left + alvo.width / 2 - (origem.left + origem.width / 2)
  const dy = alvo.top + alvo.height / 2 - (origem.top + origem.height / 2)
  const anim = el.animate([
    { transform: "translate(0,0) scale(1)", opacity: 1 },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 60}px) scale(1.1)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(.45)`, opacity: 0.3 },
  ], { duration: 700, easing: "cubic-bezier(.5,0,.75,.6)" })
  anim.onfinish = () => { el.remove(); pular() }
}
