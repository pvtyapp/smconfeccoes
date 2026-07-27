// Fonte única de verdade do "quando chamar window.print()". Antes disso cada
// tela usava setTimeout(..., 300) fixo — se a logo (imagem) ainda não tivesse
// carregado nesses 300ms, a altura da via mudava depois que o Chrome já tinha
// calculado a paginação, deslocando conteúdo e cortando a via no meio da folha
// (mais visível na reimpressão, quando a via fica mais alta com itens novos).
//
// Aqui esperamos as fontes carregarem, todas as imagens da página resolverem
// (load ou error, nunca travamos por uma imagem quebrada) e dois frames de
// layout/paint antes de disparar a impressão de verdade.
export function printWhenReady() {
  const imgs = Array.from(document.images)
  const imagesReady = Promise.all(
    imgs.map(img =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>(resolve => {
            img.addEventListener("load", () => resolve(), { once: true })
            img.addEventListener("error", () => resolve(), { once: true })
          })
    )
  )
  const fontsReady = (document as any).fonts?.ready ?? Promise.resolve()

  Promise.all([imagesReady, fontsReady]).then(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print())
    })
  })
}
