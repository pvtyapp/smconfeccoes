"use client"

// Fonte única de verdade do shell de impressão A4 (PDV, Autoatendimento,
// Relatório Financeiro, Ficha de Produção). Antes disso cada tela reimplementava
// esse CSS por conta própria e a correção abaixo foi aplicada em 2 de 3 lugares
// e esquecida no terceiro — daí o bug da folha 2 sendo cortada no relatório.
//
// Regra fixa: o wrapper é position:absolute, nunca fixed. No Chrome,
// position:fixed trava o conteúdo ao viewport da 1ª página e descarta tudo que
// passa de 1 folha. absolute deixa o conteúdo em fluxo normal, então o motor de
// impressão pagina de verdade em folha 2, 3... conforme a altura real do
// conteúdo — sem cortar nada.
export default function PrintShell({
  wrapperClass,
  pageSize = "A4 portrait",
  pageMargin = "0",
  onDone,
  children,
}: {
  wrapperClass: string
  pageSize?: string
  pageMargin?: string
  onDone: () => void
  children: React.ReactNode
}) {
  return (
    <div className="hidden print:block bg-white">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .${wrapperClass}, .${wrapperClass} * { visibility: visible !important; }
          .${wrapperClass} { position: absolute; top: 0; left: 0; right: 0; }
          .${wrapperClass} .print-avoid-break { page-break-inside: avoid; }
          @page { size: ${pageSize}; margin: ${pageMargin}; }
        }
      `}</style>
      <div className={wrapperClass}>{children}</div>
      <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
    </div>
  )
}
