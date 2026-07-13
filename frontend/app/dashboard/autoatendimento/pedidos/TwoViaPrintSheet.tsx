"use client"

// Layout compartilhado das fichas de 2 vias (Produto e DTF). Renderiza as duas
// vias em fluxo normal do documento (sem position fixed/absolute e sem grid
// forçando meia-folha) — o motor de impressão do navegador decide sozinho, pela
// altura real do conteúdo, se as duas cabem numa folha só ou se a via CLIENTE
// precisa ir pra folha seguinte. Isso substitui a antiga heurística baseada em
// contagem de itens, que cortava conteúdo quando a via LOJA passava da metade.
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
