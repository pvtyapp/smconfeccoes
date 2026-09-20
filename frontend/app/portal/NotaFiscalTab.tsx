"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { FileText, Send, Info, Download, CheckCircle2, Clock } from "lucide-react"

type Order = { id: number; number: string; status: string; totalValue: number | null; createdAt: string; fiscalNoteStatus: string | null }
type NotasResponse = { nfeEligible: boolean; tipoPessoa: string | null; regimeTributario: string | null; orders: Order[] }
type NotaEmitida = {
  id: number; numero: string | null; serie: string | null; chaveAcesso: string | null; protocolo: string | null
  valorTotal: number | null; autorizadoEm: string; pdfAvailable: boolean
}

const PERIODS = [
  { value: "hoje", label: "Hoje" },
  { value: "ontem", label: "Ontem" },
  { value: "7d", label: "7 dias" },
  { value: "10d", label: "10 dias" },
  { value: "custom", label: "Calendário" },
]

// Mesma régua de lib/fiscal/emitirNota.ts — nota fiscal só sai dentro de 10
// dias do pedido, não adianta deixar escolher período/calendário além disso.
const NFE_MAX_AGE_DAYS = 10
function oldestAllowedISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - NFE_MAX_AGE_DAYS)
  return d.toISOString().slice(0, 10)
}

function fmtR(v: number | null) {
  return `R$ ${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR")
}

export default function NotaFiscalTab() {
  const [subTab, setSubTab] = useState<"solicitar" | "emitidas">("solicitar")
  const [period, setPeriod] = useState("10d")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [data, setData] = useState<NotasResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState("")
  const [okMsg, setOkMsg] = useState("")

  const load = useCallback(async () => {
    if (period === "custom" && (!customFrom || !customTo)) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ period })
      if (period === "custom") { params.set("from", customFrom); params.set("to", customTo) }
      const res = await fetch(`/api/portal/notas?${params}`)
      const json = await res.json()
      setData(json)
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }, [period, customFrom, customTo])

  useEffect(() => { load() }, [load])

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleSolicitar() {
    setError(""); setOkMsg(""); setRequesting(true)
    try {
      const res = await fetch("/api/portal/notas/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [...selected] }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? "Não foi possível solicitar a nota"); return }
      setOkMsg("Nota solicitada! Assim que a Sefaz autorizar, ela cai automaticamente aqui e no seu WhatsApp.")
      load()
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setRequesting(false)
    }
  }

  const selectedTotal = data?.orders.filter((o) => selected.has(o.id)).reduce((s, o) => s + Number(o.totalValue ?? 0), 0) ?? 0

  if (loading && !data) return <p className="text-sm text-[#0F1E3C]/40">Carregando...</p>

  if (data && !data.nfeEligible) {
    const reason = data.tipoPessoa === "fisica"
      ? "Emissão de nota fiscal está disponível só para Pessoa Jurídica."
      : data.regimeTributario === "mei"
        ? "MEI não emite nota fiscal por aqui."
        : "Complete seu regime tributário em Meus Dados pra liberar a emissão de nota."
    return (
      <div className="flex flex-col items-center text-center gap-3 py-16 border border-dashed border-[#0F1E3C]/15 rounded-2xl text-[#0F1E3C]/40">
        <Info size={24} />
        <p className="text-sm max-w-[36ch]">{reason}</p>
        {data.tipoPessoa === "juridica" && data.regimeTributario !== "mei" && (
          <Link href="/portal" className="text-xs font-bold text-[#4361EE] hover:underline">Completar em Meus Dados →</Link>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-sm font-semibold bg-white w-fit">
        <button onClick={() => setSubTab("solicitar")}
          className={`px-4 py-2.5 transition-colors ${subTab === "solicitar" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
          Solicitar
        </button>
        <button onClick={() => setSubTab("emitidas")}
          className={`px-4 py-2.5 transition-colors ${subTab === "emitidas" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
          Notas emitidas
        </button>
      </div>

      {subTab === "solicitar" ? (
        <div className="bg-white border border-[#0F1E3C]/8 rounded-2xl p-5">
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 mb-4">
            <Info size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Nota fiscal só pode ser emitida em até {NFE_MAX_AGE_DAYS} dias depois do pedido — por isso só aparecem aqui os pedidos desse período.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {PERIODS.map((p) => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${period === p.value ? "bg-[#4361EE] text-white" : "bg-[#F4F6FB] text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/8"}`}>
                {p.label}
              </button>
            ))}
          </div>

          {period === "custom" && (
            <div className="flex items-center gap-2 mb-4">
              <input type="date" value={customFrom} min={oldestAllowedISO()} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-[#0F1E3C]/15 rounded-lg px-3 py-2 text-xs" />
              <span className="text-xs text-[#0F1E3C]/40">até</span>
              <input type="date" value={customTo} min={customFrom || oldestAllowedISO()} onChange={(e) => setCustomTo(e.target.value)}
                className="border border-[#0F1E3C]/15 rounded-lg px-3 py-2 text-xs" />
            </div>
          )}

          {!data || data.orders.length === 0 ? (
            <p className="text-sm text-[#0F1E3C]/35 text-center py-10">Nenhum pedido nesse período.</p>
          ) : (
            <div className="space-y-2">
              {data.orders.map((o) => {
                const hasNote = !!o.fiscalNoteStatus
                return (
                  <label key={o.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${hasNote ? "bg-[#F4F6FB] border-[#0F1E3C]/6 opacity-60" : "border-[#0F1E3C]/8 hover:bg-[#F4F6FB] cursor-pointer"}`}>
                    <input type="checkbox" disabled={hasNote} checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                    <span className="flex-1 text-sm text-[#0F1E3C]">Pedido {o.number}</span>
                    <span className="text-xs text-[#0F1E3C]/40">{fmtDate(o.createdAt)}</span>
                    <span className="text-sm font-bold text-[#0F1E3C]">{fmtR(o.totalValue)}</span>
                    {hasNote && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#4361EE]/10 text-[#4361EE]">
                        {o.fiscalNoteStatus === "autorizada" ? "Nota emitida" : "Nota em análise"}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          )}

          {error && <p className="text-xs text-red-600 mt-3" role="alert">{error}</p>}
          {okMsg && <p className="text-xs text-[#1B8F63] font-semibold mt-3 flex items-center gap-1.5" role="status"><CheckCircle2 size={13} /> {okMsg}</p>}

          {selected.size > 0 && (
            <button onClick={handleSolicitar} disabled={requesting}
              className="w-full mt-4 inline-flex items-center justify-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white font-bold text-sm py-3 rounded-xl transition-colors disabled:opacity-50">
              <Send size={15} />
              {requesting ? "Solicitando..." : `Solicitar nota fiscal (${selected.size} selecionado${selected.size > 1 ? "s" : ""} — ${fmtR(selectedTotal)})`}
            </button>
          )}
        </div>
      ) : (
        <NotasEmitidas />
      )}
    </div>
  )
}

function NotasEmitidas() {
  const [notas, setNotas] = useState<NotaEmitida[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/portal/notas/emitidas").then((r) => r.json()).then(setNotas).finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sm text-[#0F1E3C]/40">Carregando...</p>
  if (notas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-[#0F1E3C]/30">
        <FileText size={24} />
        <p className="text-sm">Nenhuma nota emitida ainda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {notas.map((n) => (
        <div key={n.id} className="bg-white border border-[#0F1E3C]/8 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#0F1E3C]">NFe nº {n.numero ?? "—"} / série {n.serie ?? "—"}</p>
              <p className="text-xs text-[#0F1E3C]/45 mt-0.5">Emitida em {fmtDate(n.autorizadoEm)} · {fmtR(n.valorTotal)}</p>
              {n.chaveAcesso && <p className="text-[11px] text-[#0F1E3C]/35 mt-1 font-mono break-all">{n.chaveAcesso}</p>}
            </div>
            {n.pdfAvailable ? (
              <a href={`/api/portal/notas/${n.id}?type=pdf`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#4361EE] hover:underline flex-shrink-0">
                <Download size={13} /> Baixar PDF
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[#0F1E3C]/35 flex-shrink-0" title="Arquivo disponível por 7 dias — já foi enviado no seu WhatsApp">
                <Clock size={12} /> Arquivo expirado
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
