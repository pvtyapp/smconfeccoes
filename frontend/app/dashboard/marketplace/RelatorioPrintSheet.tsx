"use client"

import PrintShell from "@/components/print/PrintShell"
import DocLetterhead from "@/components/print/DocLetterhead"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

export type ProdutoGrade = {
  productName: string
  sizes: string[]
  linhas: { color: string; qtys: number[]; total: number }[]
  totaisTam: number[]
  total: number
}

// Folha A4 das quantidades unificadas do Relatório de baixas — mesmo padrão
// visual da Ficha de Separação (PrintShell + DocLetterhead + navy), uma grade
// cor × tamanho por produto.
export default function RelatorioPrintSheet({ grade, loja, periodo, baixas, totalPecas, onDone }: {
  grade: ProdutoGrade[]; loja: string; periodo: string; baixas: string[]; totalPecas: number; onDone: () => void
}) {
  const tz = "America/Sao_Paulo"
  const now = new Date()
  const printDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const printTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })
  const th = { padding: "4px 6px", fontSize: "7px", fontWeight: 700, letterSpacing: "0.5px" } as const

  return (
    <PrintShell wrapperClass="print-a4" onDone={onDone}>
      <div style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", padding: "14mm 16mm", color: NAVY }}>
        <DocLetterhead />

        <div style={{ background: NAVY, color: "white", borderRadius: "4px", padding: "5px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px" }}>
          <span style={{ fontWeight: 800, fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase" }}>Relatório de Baixas · Marketplace</span>
          <span style={{ fontSize: "8px", opacity: 0.75 }}>Impressão: {printDate} {printTime}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", border: "1px solid #d8dde8", borderRadius: "4px", overflow: "hidden", marginBottom: "9px" }}>
          {([["Loja", loja], ["Período", periodo], ["Baixas", String(baixas.length)], ["Peças", String(totalPecas)]] as [string, string][]).map(([l, v], i) => (
            <div key={l} style={{ padding: "5px 8px", borderRight: i < 3 ? "1px solid #d8dde8" : "none", background: i % 2 === 0 ? NAVY_LIGHT : "white" }}>
              <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>{l}</div>
              <div style={{ fontSize: "10.5px", fontWeight: 700, color: NAVY, marginTop: "2px" }}>{v}</div>
            </div>
          ))}
        </div>

        {grade.map(g => (
          <table key={g.productName} className="print-avoid-break" style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
            <thead>
              <tr style={{ background: NAVY, color: "white" }}>
                <th style={{ ...th, textAlign: "left", fontSize: "8.5px" }}>{g.productName.toUpperCase()}</th>
                {g.sizes.map(s => <th key={s} style={{ ...th, textAlign: "center", width: "34px" }}>{s || "U"}</th>)}
                <th style={{ ...th, textAlign: "center", width: "40px" }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {g.linhas.map((l, i) => (
                <tr key={l.color} style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e0e4ec" }}>
                  <td style={{ padding: "3.5px 6px", fontSize: "9px", fontWeight: 600 }}>{l.color}</td>
                  {l.qtys.map((q, j) => (
                    <td key={j} style={{ padding: "3.5px 6px", textAlign: "center", fontSize: q ? "10.5px" : "8px", fontWeight: q ? 900 : 400, color: q ? NAVY : "#c4c9d4" }}>{q || "·"}</td>
                  ))}
                  <td style={{ padding: "3.5px 6px", textAlign: "center", fontSize: "10.5px", fontWeight: 900 }}>{l.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#dfe4ef" }}>
                <td style={{ padding: "4px 6px", fontSize: "7.5px", fontWeight: 700, letterSpacing: "0.5px" }}>TOTAL</td>
                {g.totaisTam.map((q, j) => <td key={j} style={{ padding: "4px 6px", textAlign: "center", fontSize: "9.5px", fontWeight: 800 }}>{q || "·"}</td>)}
                <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "11px", fontWeight: 900 }}>{g.total}</td>
              </tr>
            </tfoot>
          </table>
        ))}

        <div style={{ background: NAVY, color: "white", borderRadius: "4px", padding: "6px 10px", display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
          <span style={{ fontSize: "8.5px", fontWeight: 700, letterSpacing: "0.5px" }}>TOTAL GERAL · {grade.length} produto{grade.length === 1 ? "" : "s"}</span>
          <span style={{ fontSize: "12px", fontWeight: 900 }}>{totalPecas} peças</span>
        </div>

        {baixas.length > 0 && (
          <p style={{ fontSize: "7px", color: "#777", marginTop: "8px", lineHeight: 1.5 }}>
            <b>Baixas incluídas:</b> {baixas.join(", ")}
          </p>
        )}

        <div style={{ marginTop: "10px", paddingTop: "6px", borderTop: "1px dashed #ccc", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>SM Confecções · Av. Santa Cruz, 3088 · Franca/SP</span>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>{printDate}</span>
        </div>
      </div>
    </PrintShell>
  )
}
