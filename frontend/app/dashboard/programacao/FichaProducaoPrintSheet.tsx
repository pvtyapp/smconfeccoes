"use client"

import PrintShell from "@/components/print/PrintShell"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

const thStyle: React.CSSProperties = {
  border: "1px solid rgba(15,30,60,.35)", background: NAVY_LIGHT, height: "4mm",
}
const colorBlankStyle: React.CSSProperties = {
  border: "1px solid rgba(15,30,60,.35)", background: "#F9FAFC", minWidth: "14mm", height: "6mm",
}
const cellStyle: React.CSSProperties = {
  border: "1px solid rgba(15,30,60,.35)", minWidth: "7mm", height: "6mm",
}
const labelSmStyle: React.CSSProperties = {
  fontSize: "7.5px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.4px",
  color: "rgba(15,30,60,.45)", marginBottom: "1mm", display: "block",
}
const sigLineStyle: React.CSSProperties = { borderBottom: "1px solid rgba(15,30,60,.4)", height: "4mm", marginBottom: "0.8mm" }
const sigCapStyle: React.CSSProperties = { fontSize: "7px", color: "rgba(15,30,60,.4)" }

function FillRow({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "1.5mm", fontSize: "8.5px", marginBottom: "1.8mm" }}>
      <span style={{ fontWeight: 800, textTransform: "uppercase", fontSize: "7px", letterSpacing: "0.4px", color: "rgba(15,30,60,.5)", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ flex: 1, borderBottom: "1px solid rgba(15,30,60,.4)", height: "3.4mm" }} />
    </div>
  )
}

function Ficha({ isLast }: { isLast: boolean }) {
  return (
    <>
      <div className="print-avoid-break" style={{ border: `1.4px solid ${NAVY}`, borderRadius: "3px", marginBottom: "5mm", overflow: "hidden" }}>
        <div style={{ background: NAVY, color: "#fff", padding: "2.6mm 4mm", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: "10.5px", fontWeight: 800, letterSpacing: "0.4px", textTransform: "uppercase" }}>Ficha de Ordem de Produção</span>
          <span style={{ fontSize: "7.5px", opacity: 0.7 }}>preencher tudo à mão</span>
        </div>
        <div style={{ padding: "3mm 4mm", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
          <div>
            <FillRow label="Produto" />
            <FillRow label="Data" />
            <FillRow label="Bobina/Lote" />
            <FillRow label="Bobina/Lote" />
            <FillRow label="Bobina/Lote" />
            <FillRow label="Bobina/Lote" />
            <div>
              <span style={labelSmStyle}>Obs.</span>
              <div style={{ borderBottom: "1px solid rgba(15,30,60,.3)", height: "4mm" }} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2.5mm" }}>
            <div>
              <span style={labelSmStyle}>Cor / Grade / Quantidade</span>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <tbody>
                  <tr>
                    <td style={{ ...thStyle, background: "#fff", border: "none" }} />
                    {[0, 1, 2, 3].map(c => <td key={c} style={thStyle} />)}
                  </tr>
                  {[0, 1, 2, 3].map(r => (
                    <tr key={r}>
                      <td style={colorBlankStyle} />
                      {[0, 1, 2, 3].map(c => <td key={c} style={cellStyle} />)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: "4mm", marginTop: "1mm" }}>
              <div style={{ flex: 1 }}><div style={sigLineStyle} /><span style={sigCapStyle}>Conferido por</span></div>
              <div style={{ flex: 1 }}><div style={sigLineStyle} /><span style={sigCapStyle}>Data</span></div>
            </div>
          </div>
        </div>
      </div>
      {!isLast && (
        <div style={{ borderTop: "1px dashed rgba(15,30,60,.35)", margin: "0 0 5mm", paddingTop: "1.5mm" }}>
          <span style={{ fontSize: "7px", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 700, color: "rgba(15,30,60,.32)" }}>
            ✂ corte aqui
          </span>
        </div>
      )}
    </>
  )
}

export default function FichaProducaoPrintSheet({ sheets, onDone }: { sheets: number; onDone: () => void }) {
  const tz = "America/Sao_Paulo"
  const printDate = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })

  return (
    <PrintShell wrapperClass="print-ficha-producao" onDone={onDone}>
      {Array.from({ length: sheets }, (_, s) => (
        <div key={s} style={{
          fontFamily: "'Arial', 'Helvetica', sans-serif", color: NAVY, padding: "10mm",
          pageBreakAfter: s < sheets - 1 ? "always" : "auto",
        }}>
          {/* Letterhead — mesmo padrão do PDV/Autoatendimento */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            paddingBottom: "4mm", marginBottom: "6mm", borderBottom: `1.6px solid ${NAVY}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <img src="/smsemfundo.png" alt="SM Confecções" style={{ height: "46px", width: "auto", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "16px", fontWeight: 900, letterSpacing: "-0.5px", lineHeight: 1, color: NAVY }}>SM CONFECÇÕES</div>
                <div style={{ fontSize: "8px", color: "#666", marginTop: "3px" }}>Ficha de Ordem de Produção · uso interno</div>
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: "8px", color: "#888" }}>
              Impresso em {printDate}<br />3 fichas por folha
            </div>
          </div>

          <Ficha isLast={false} />
          <Ficha isLast={false} />
          <Ficha isLast={true} />
        </div>
      ))}
    </PrintShell>
  )
}
