"use client"

import PrintShell from "@/components/print/PrintShell"

// Layout compartilhado das fichas de 2 vias (Produto e DTF). As vias empilham
// em fluxo normal (sem grid forçando meia-folha) — o motor de impressão decide
// sozinho, pela altura real do conteúdo, se cabem numa folha só ou se a via
// CLIENTE vai pra folha seguinte. Isso substitui a antiga heurística por
// contagem de itens, que cortava conteúdo quando a via LOJA passava da metade.
//
// O CSS de paginação (position:absolute, nunca fixed) vive em PrintShell —
// fonte única de verdade compartilhada com PDV e Relatório Financeiro.
export default function TwoViaPrintSheet({ wrapperClass, renderVia, onDone }: {
  wrapperClass: string
  renderVia: (via: "LOJA" | "CLIENTE") => React.ReactNode
  onDone: () => void
}) {
  return (
    <PrintShell wrapperClass={wrapperClass} onDone={onDone}>
      <div className="via-block print-avoid-break">{renderVia("LOJA")}</div>
      <div className="via-block print-avoid-break" style={{ borderTop: "1.5px dashed #bbb" }}>{renderVia("CLIENTE")}</div>
    </PrintShell>
  )
}
