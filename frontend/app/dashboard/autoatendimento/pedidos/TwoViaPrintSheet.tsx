"use client"

import PrintShell from "@/components/print/PrintShell"

// Layout compartilhado das fichas de 2 vias (Produto e DTF) — é tipo um cupom
// fiscal: as duas vias são idênticas (só troca o selo LOJA/CLIENTE), uma pra
// loja arquivar e outra pra entregar ao cliente.
//
// Cada via tem altura mínima de meia folha A4 (148,5mm = 297mm / 2). Pedido
// curto: as duas enchem 148,5mm cada e a folha fecha certinha, dividida ao
// meio por uma linha pontilhada. Pedido longo (a via passa de meia folha):
// print-avoid-break força o motor de impressão a não cortar a via no meio —
// ela empurra a via inteira pra próxima folha, virando 2 folhas (uma por
// via) em vez de cortar conteúdo. Sem contar item, sem heurística — o
// próprio motor de impressão decide pela altura real do conteúdo.
//
// O CSS de paginação (position:absolute, nunca fixed) vive em PrintShell —
// fonte única de verdade compartilhada com PDV e Relatório Financeiro.
export default function TwoViaPrintSheet({ wrapperClass, renderVia, onDone }: {
  wrapperClass: string
  renderVia: (via: "LOJA" | "CLIENTE") => React.ReactNode
  onDone: () => void
}) {
  const halfPage: React.CSSProperties = { minHeight: "148.5mm", boxSizing: "border-box" }
  return (
    <PrintShell wrapperClass={wrapperClass} onDone={onDone}>
      <div className="via-block print-avoid-break" style={halfPage}>{renderVia("LOJA")}</div>
      <div className="via-block print-avoid-break" style={{ ...halfPage, borderTop: "1.5px dashed #bbb" }}>{renderVia("CLIENTE")}</div>
    </PrintShell>
  )
}
