"use client"

import { createPortal } from "react-dom"

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
//
// Portal pro <body>: os modais que chamam isso (ex: ficha de pedido) ficam
// aninhados dentro do painel do Kanban, que é position:absolute dentro do
// <main> do layout (position:relative, com padding, ao lado da sidebar).
// Sem o portal, o "position:absolute" acima herda esse ancestral como
// referência em vez da página — sobra uma faixa em branco à esquerda do
// tamanho da sidebar + padding do painel. O portal tira o conteúdo desse
// aninhamento e anexa direto no body, então a referência vira sempre a
// página inteira, não importa onde o botão de imprimir foi clicado.
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
  if (typeof document === "undefined") return null

  return createPortal(
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
    </div>,
    document.body
  )
}
