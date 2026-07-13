"use client"

// Layout compartilhado das fichas de 2 vias (Produto e DTF). As vias empilham
// em fluxo normal (sem grid forçando meia-folha) — o motor de impressão decide
// sozinho, pela altura real do conteúdo, se cabem numa folha só ou se a via
// CLIENTE vai pra folha seguinte. Isso substitui a antiga heurística por
// contagem de itens, que cortava conteúdo quando a via LOJA passava da metade.
//
// O wrapper precisa de position:absolute (igual ao PdvReceiptModal) pra sair
// do fluxo normal da página por trás — sem isso, ao imprimir de dentro de uma
// tela cujo container raiz é display:flex (o Kanban, page.tsx), o wrapper vira
// item de flex e disputa largura com os painéis vizinhos (mesmo escondidos por
// visibility:hidden, que não tira do layout) — a folha aparece espremida numa
// coluna estreita, com as duas vias fragmentadas lado a lado em vez de
// empilhadas. Só "fixed" é proibido aqui: no Chrome, position:fixed trava o
// elemento a 1 viewport e corta conteúdo que passa de 1 página.
export default function TwoViaPrintSheet({ wrapperClass, renderVia, onDone }: {
  wrapperClass: string
  renderVia: (via: "LOJA" | "CLIENTE") => React.ReactNode
  onDone: () => void
}) {
  return (
    <div className="hidden print:block bg-white">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .${wrapperClass}, .${wrapperClass} * { visibility: visible !important; }
          .${wrapperClass} { position: absolute; top: 0; left: 0; right: 0; }
          .${wrapperClass} .via-block { page-break-inside: avoid; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>
      <div className={wrapperClass}>
        <div className="via-block">{renderVia("LOJA")}</div>
        <div className="via-block" style={{ borderTop: "1.5px dashed #bbb" }}>{renderVia("CLIENTE")}</div>
      </div>
      <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
    </div>
  )
}
