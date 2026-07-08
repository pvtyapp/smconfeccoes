"use client"

import { useState, useEffect } from "react"
import { X, Download, Check, ChevronRight, AlertCircle, Loader2, FileImage, Printer, RotateCcw } from "lucide-react"
import type { DtfOrder } from "./DtfOrderCard"
import { subDaysBR } from "@/lib/tz"
import Toggle from "@/components/Toggle"

type Props = {
  order: DtfOrder
  onClose: () => void
  onRefresh: () => void
  numImpressoras?: number
}

const STATUS_LABEL: Record<string, string> = {
  triagem:     "Triagem",
  em_producao: "Em Produção",
  pronto:      "Pronto",
  concluido:   "Concluído",
  cancelado:   "Cancelado",
}

const STATUS_COLOR: Record<string, string> = {
  triagem:     "bg-amber-100 text-amber-700",
  em_producao: "bg-blue-100 text-blue-700",
  pronto:      "bg-green-100 text-green-700",
  concluido:   "bg-[#0F1E3C]/10 text-[#0F1E3C]/50",
  cancelado:   "bg-red-100 text-red-600",
}

export default function DtfOrderModal({ order, onClose, onRefresh, numImpressoras = 1 }: Props) {
  const [downloading,    setDownloading]    = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [metrosFinais,   setMetrosFinais]   = useState(order.metrosFinais ? String(order.metrosFinais) : "")
  const [precoPorMetro,  setPrecoPorMetro]  = useState<number | null>(null)
  const [precoCarregado, setPrecoCarregado] = useState(false)
  const [isPaid,         setIsPaid]         = useState(order.isPaid ?? true)
  const [dueDate,        setDueDate]        = useState("")
  const [error,          setError]          = useState("")
  const [showCancel,     setShowCancel]     = useState(false)
  const [notifyClient,   setNotifyClient]   = useState(true)
  const [cancelMsg,      setCancelMsg]      = useState(`Seu pedido DTF ${order.number} foi cancelado. Qualquer dúvida é só chamar.`)
  const [impressoraId,   setImpressoraId]   = useState<number>(
    numImpressoras > 1 ? (order.impressoraId ?? 0) : (order.impressoraId ?? 1)
  )
  const [showPrint,      setShowPrint]      = useState(false)
  const [printFormat,    setPrintFormat]    = useState<"a4" | "thermal">("a4")
  const [hasDownloaded,  setHasDownloaded]  = useState(false)
  const [hasPrinted,     setHasPrinted]     = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(`dtf_dl_${order.id}`))    setHasDownloaded(true)
      if (localStorage.getItem(`dtf_print_${order.id}`)) setHasPrinted(true)
    } catch { /* ignore */ }
  }, [order.id])

  useEffect(() => {
    fetch("/api/dtf/preco")
      .then(r => r.ok ? r.json() : null)
      .then(d => { setPrecoPorMetro(d?.precoMetro ?? null); setPrecoCarregado(true) })
      .catch(() => setPrecoCarregado(true))
  }, [])

  const metros = parseFloat(metrosFinais)
  const valorCalculado = precoPorMetro && metrosFinais && !isNaN(metros) && metros > 0
    ? metros * precoPorMetro
    : null

  const isTriagem  = order.status === "triagem"
  const isProducao = order.status === "em_producao"
  const isProto    = order.status === "pronto"
  const isDone     = order.status === "concluido" || order.status === "cancelado"
  const nomeCliente = order.contactName ?? order.cliente ?? "Cliente não identificado"

  function handlePrint() {
    setHasPrinted(true)
    try { localStorage.setItem(`dtf_print_${order.id}`, "1") } catch { /* ignore */ }
    setShowPrint(true)
    setTimeout(() => window.print(), 300)
  }

  async function downloadArtes() {
    setDownloading(true)
    setError("")
    try {
      const slug = nomeCliente.split(" ")[0]
      const r = await fetch(`/api/dtf/pedidos/${order.id}/download`)
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error ?? `Falha ao baixar (${r.status})`)
      }
      const contentType = r.headers.get("content-type") ?? ""
      const blob = await r.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      a.download = contentType.includes("zip")
        ? `${slug}-artes.zip`
        : `${slug}-arte.${order.attachments[0]?.filename?.split(".").pop() ?? "png"}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setHasDownloaded(true)
      try { localStorage.setItem(`dtf_dl_${order.id}`, "1") } catch { /* ignore */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao baixar arquivo")
    } finally {
      setDownloading(false)
    }
  }

  async function advanceStatus() {
    setError("")

    if (isTriagem) {
      if (!metrosFinais || isNaN(metros) || metros <= 0) {
        setError("Informe a metragem antes de iniciar a produção.")
        return
      }
      if (numImpressoras > 1 && !impressoraId) {
        setError("Selecione a impressora antes de iniciar a produção.")
        return
      }
    }

    if (isProducao) {
      if (!metrosFinais || isNaN(metros) || metros <= 0) {
        setError("Informe os metros finais antes de marcar como pronto.")
        return
      }
      if (!precoPorMetro) {
        setError("Produto DTF não cadastrado. Configure em Produtos antes de continuar.")
        return
      }
    }

    setSaving(true)
    try {
      const nextStatus = isTriagem ? "em_producao" : "pronto"
      const body: Record<string, unknown> = { status: nextStatus }
      if (metrosFinais && !isNaN(metros)) body.metrosFinais = metros
      if (valorCalculado)  body.precoCobrado = valorCalculado
      if (isTriagem)       body.impressoraId = impressoraId || 1

      const r = await fetch(`/api/dtf/pedidos/${order.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const d = await r.json()
        setError(d.error ?? "Erro ao atualizar")
        return
      }
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  function saveImpressoraId(val: number) {
    setImpressoraId(val)
    setError("")
    fetch(`/api/dtf/pedidos/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ impressoraId: val }),
    }).catch(() => {})
  }

  async function concluir() {
    if (!isPaid && !dueDate) {
      setError("Informe a data de vencimento pra concluir a prazo.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const r = await fetch(`/api/dtf/pedidos/${order.id}/conclude`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid, dueDate: isPaid ? undefined : dueDate }),
      })
      if (!r.ok) {
        const d = await r.json()
        setError(d.error ?? "Erro ao concluir")
        return
      }
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  async function confirmCancelDtf() {
    setSaving(true)
    try {
      await fetch(`/api/dtf/pedidos/${order.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "cancelado",
          notifyClient,
          cancelMessage: notifyClient ? cancelMsg : undefined,
        }),
      })
      setShowCancel(false)
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="text-base font-black text-[#0F1E3C]">{order.number}</h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[order.status] ?? "bg-gray-100 text-gray-500"}`}>
                {STATUS_LABEL[order.status] ?? order.status}
              </span>
              <span className="text-[10px] font-bold text-[#7C3AED] bg-purple-100 px-2 py-0.5 rounded-full">DTF</span>
            </div>
            <p className="text-xs text-[#0F1E3C]/40">
              {nomeCliente}{order.contactPhone ? ` · ${order.contactPhone}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Obs banner */}
          {order.observacao && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
              <p className="text-xs text-amber-700">
                <span className="font-semibold">Obs:</span> {order.observacao}
              </p>
            </div>
          )}

          {/* Pronto banner */}
          {isProto && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-green-700 uppercase tracking-wider">Pronto para retirada</p>
                {order.metrosFinais && (
                  <p className="text-sm text-green-700 mt-0.5">{Number(order.metrosFinais).toFixed(2)} m</p>
                )}
              </div>
              {order.precoCobrado && (
                <p className="text-xl font-black text-green-700">
                  R$ {Number(order.precoCobrado).toFixed(2).replace(".", ",")}
                </p>
              )}
            </div>
          )}

          {/* DTF info card */}
          <div className="bg-[#F4F6FB] rounded-2xl overflow-hidden border border-[#0F1E3C]/6">
            <div className="px-4 py-2.5 border-b border-[#0F1E3C]/6">
              <span className="text-[10px] font-bold text-[#7C3AED] uppercase tracking-wider">Impressão DTF</span>
            </div>

            {order.metros && (
              <div className="px-4 py-3 flex items-center justify-between border-b border-[#0F1E3C]/5">
                <span className="text-xs text-[#0F1E3C]/50">Metros pedidos</span>
                <span className="text-sm font-bold text-[#0F1E3C]">{Number(order.metros).toFixed(2)} m</span>
              </div>
            )}

            {order.larguraCm && (
              <div className={`px-4 py-3 flex items-center justify-between ${(isTriagem || isProducao) ? "border-b border-[#0F1E3C]/5" : ""}`}>
                <span className="text-xs text-[#0F1E3C]/50">Largura</span>
                <span className="text-sm font-bold text-[#0F1E3C]">{order.larguraCm} cm</span>
              </div>
            )}

            {(isTriagem || isProducao) && (
              <>
                <div className="px-4 py-3 border-b border-[#0F1E3C]/5">
                  <label className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wider block mb-1.5">
                    {isTriagem ? "Metros estimados *" : "Metros finais impressos *"}
                  </label>
                  <input
                    type="number" step="0.01" min="0"
                    value={metrosFinais}
                    onChange={e => { setMetrosFinais(e.target.value); setError("") }}
                    placeholder="Ex: 2.50"
                    className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                  />
                </div>

                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-[#0F1E3C]/50">Valor calculado</span>
                  {!precoCarregado ? (
                    <span className="text-xs text-[#0F1E3C]/40">Carregando...</span>
                  ) : !precoPorMetro ? (
                    <span className="text-xs text-amber-600 font-medium">Produto DTF não cadastrado</span>
                  ) : valorCalculado ? (
                    <span className="text-base font-black text-emerald-700">
                      R$ {valorCalculado.toFixed(2).replace(".", ",")}
                      <span className="text-[10px] font-normal text-[#0F1E3C]/30 ml-1.5">
                        R$ {precoPorMetro.toFixed(2)}/m
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-[#0F1E3C]/30">Informe os metros</span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Impressora selector — sempre visível com múltiplas impressoras */}
          {!isDone && numImpressoras > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider block">
                Impressora{isTriagem ? " *" : ""}
              </label>
              <div className="flex gap-2">
                {Array.from({ length: numImpressoras }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => saveImpressoraId(n)}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                      impressoraId === n
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-[#F4F6FB] text-[#0F1E3C]/50 border-[#0F1E3C]/8 hover:text-[#0F1E3C]"
                    }`}
                  >
                    Impressora {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Arquivos da arte */}
          {order.attachments.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider">
                  Arquivos da Arte ({order.attachments.length})
                </p>
                <div className="flex items-center gap-1.5">
                  {hasDownloaded && !downloading && (
                    <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-0.5">
                      <Check size={10} /> Baixado
                    </span>
                  )}
                  <button
                    onClick={downloadArtes}
                    disabled={downloading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-50 ${
                      hasDownloaded ? "bg-emerald-600 hover:bg-emerald-700" : "bg-[#7C3AED] hover:bg-[#6D28D9]"
                    }`}
                  >
                    {downloading
                      ? <><Loader2 size={11} className="animate-spin" /> Baixando...</>
                      : <><Download size={11} /> {order.attachments.length > 1 ? `Baixar ZIP (${order.attachments.length})` : "Baixar renomeado"}</>
                    }
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {order.attachments.map((a, i) => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 bg-[#F4F6FB] border border-[#0F1E3C]/8 rounded-xl">
                    <FileImage size={13} className="text-[#7C3AED] flex-shrink-0" />
                    <span className="text-xs font-medium text-[#0F1E3C] truncate flex-1">
                      {a.filename ?? `arquivo-${i + 1}`}
                    </span>
                    <span className="text-[10px] text-[#0F1E3C]/25 flex-shrink-0 uppercase">
                      {a.filename?.split(".").pop() ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : isTriagem ? (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} className="text-amber-600 flex-shrink-0" />
              <p className="text-xs text-amber-700">Nenhum arquivo recebido ainda. Aguardando envio do cliente.</p>
            </div>
          ) : null}

          {/* Imprimir ficha — a partir de em_producao */}
          {(isProducao || isProto) && (
            <div className="space-y-2">
              {hasPrinted && (
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600">
                  <Check size={10} /> Ficha já impressa
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium">
                  <button onClick={() => setPrintFormat("a4")}
                    className={`px-3 py-2 transition-colors ${printFormat === "a4" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
                    A4
                  </button>
                  <button onClick={() => setPrintFormat("thermal")}
                    className={`px-3 py-2 transition-colors ${printFormat === "thermal" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
                    4×6
                  </button>
                </div>
                <button onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#0F1E3C]/10 text-sm font-medium text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/6 transition-colors">
                  {hasPrinted ? <RotateCcw size={14} /> : <Printer size={14} />}
                  {hasPrinted ? "Reimprimir" : "Imprimir Ficha"}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#0F1E3C]/8 space-y-2.5">
          {isProto && !isPaid && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wider block">
                Vencimento *
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => { setDueDate(e.target.value); setError("") }}
                className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
              />
            </div>
          )}
          <div className="flex gap-2 items-center">

            {!isDone && (
              <button
                onClick={() => setShowCancel(true)}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors"
              >
                Cancelar
              </button>
            )}

            {/* triagem → em_producao */}
            {isTriagem && (
              <button
                onClick={advanceStatus}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                {saving
                  ? <Loader2 size={14} className="animate-spin" />
                  : <><Check size={14} /> Em Produção <ChevronRight size={14} /></>
                }
              </button>
            )}

            {/* em_producao → pronto */}
            {isProducao && (
              <button
                onClick={advanceStatus}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                {saving
                  ? <Loader2 size={14} className="animate-spin" />
                  : <><Check size={14} /> Pronto para Retirada <ChevronRight size={14} /></>
                }
              </button>
            )}

            {/* pronto — toggle à vista/prazo + concluir direto */}
            {isProto && (
              <>
                {order.paymentTermEnabled && (
                  <div
                    className="flex items-center gap-2 bg-[#F4F6FB] border border-[#0F1E3C]/8 rounded-xl px-3 py-2.5 cursor-pointer select-none"
                    onClick={() => {
                      const next = !isPaid
                      setIsPaid(next)
                      if (!next && !dueDate && order.paymentTermType === "days" && order.paymentTermDays) {
                        setDueDate(subDaysBR(-order.paymentTermDays))
                      }
                      setError("")
                    }}
                  >
                    <Toggle on={isPaid} onChange={() => {}} onColor="bg-emerald-500" />
                    <p className="text-xs font-semibold text-[#0F1E3C] whitespace-nowrap">{isPaid ? "À vista" : "A prazo"}</p>
                  </div>
                )}
                <button
                  onClick={concluir}
                  disabled={saving}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 ${
                    isPaid ? "bg-emerald-600 hover:bg-emerald-700" : "bg-[#0F1E3C] hover:bg-[#1B2A4A]"
                  }`}
                >
                  {saving
                    ? <Loader2 size={14} className="animate-spin" />
                    : <><Check size={14} /> {isPaid ? "Confirmar e Concluir" : "Concluir a Prazo"}</>
                  }
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {showPrint && (
        <DtfPrintSheet
          order={order}
          nomeCliente={nomeCliente}
          format={printFormat}
          onDone={() => setShowPrint(false)}
        />
      )}

      {showCancel && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-[#0F1E3C]">Cancelar pedido {order.number}?</h3>

            <div className="flex items-center gap-3">
              <Toggle on={notifyClient} onChange={() => setNotifyClient(v => !v)} />
              <p className="text-sm font-medium text-[#0F1E3C]">Notificar cliente via WhatsApp</p>
            </div>

            {notifyClient && (
              <textarea
                value={cancelMsg}
                onChange={e => setCancelMsg(e.target.value)}
                rows={3}
                className="w-full border border-[#0F1E3C]/10 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-[#F4F6FB] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 resize-none"
              />
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setShowCancel(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 transition-colors"
              >
                Voltar
              </button>
              <button
                onClick={confirmCancelDtf}
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                {saving ? "..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── DTF Print Sheet ──────────────────────────────────────────────────────────

const NAVY     = "#0F1E3C"
const NAVY_LT  = "#f0f2f7"

function DtfPrintSheet({ order, nomeCliente, format, onDone }: {
  order: DtfOrder; nomeCliente: string; format: "a4" | "thermal"; onDone: () => void
}) {
  const tz        = "America/Sao_Paulo"
  const now       = new Date()
  const printDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const printTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })
  const orderDate = new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const metros    = order.metrosFinais ?? order.metros
  const valor     = order.precoCobrado
    ? `R$ ${Number(order.precoCobrado).toFixed(2).replace(".", ",")}`
    : "—"

  if (format === "thermal") {
    return (
      <div className="hidden print:block fixed inset-0 bg-white z-[100]">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .dtf-label, .dtf-label * { visibility: visible !important; }
            .dtf-label { position: fixed; top: 0; left: 0; width: 100mm; height: 150mm; overflow: hidden; box-sizing: border-box; }
            @page { size: 100mm 150mm; margin: 0; }
          }
        `}</style>
        <div className="dtf-label" style={{
          width: "100mm", height: "150mm", padding: "5mm 6mm",
          fontFamily: "'Arial', sans-serif", color: NAVY,
          display: "flex", flexDirection: "column", boxSizing: "border-box",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3mm" }}>
            <img src="/smsemfundo.png" alt="SM" style={{ height: "28px", width: "auto", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "13px", fontWeight: "900", letterSpacing: "-0.3px", lineHeight: 1 }}>SM CONFECÇÕES</div>
              <div style={{ fontSize: "7px", color: "#666", marginTop: "2px" }}>Av. Santa Cruz, 3088 — Franca/SP</div>
            </div>
          </div>

          <div style={{
            background: "#7C3AED", color: "white", borderRadius: "3px",
            padding: "3px 7px", display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: "3mm",
          }}>
            <span style={{ fontWeight: "800", fontSize: "9px", letterSpacing: "0.8px" }}>PEDIDO DTF</span>
            <span style={{ fontSize: "7px", opacity: 0.75 }}>{printDate} {printTime}</span>
          </div>

          <div style={{
            border: `1px solid #d8dde8`, borderRadius: "3px",
            padding: "4px 7px", marginBottom: "3mm", background: NAVY_LT,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "3px" }}>
              <span style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>Pedido</span>
              <span style={{ fontSize: "12px", fontWeight: "900", color: "#7C3AED" }}>{order.number}</span>
            </div>
            <div style={{ borderTop: "1px solid #d0d5e0", paddingTop: "4px" }}>
              <div style={{ fontSize: "12px", fontWeight: "800", color: NAVY }}>{nomeCliente}</div>
              {order.contactPhone && <div style={{ fontSize: "9px", color: "#555", marginTop: "1px" }}>{order.contactPhone}</div>}
            </div>
          </div>

          <div style={{
            border: `1px solid #d8dde8`, borderRadius: "3px",
            padding: "4px 7px", marginBottom: "3mm", background: "white",
          }}>
            {metros && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                <span style={{ fontSize: "8px", color: "#888" }}>Metros</span>
                <span style={{ fontSize: "11px", fontWeight: "900", color: NAVY }}>{Number(metros).toFixed(2)} m</span>
              </div>
            )}
            {order.larguraCm && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                <span style={{ fontSize: "8px", color: "#888" }}>Largura</span>
                <span style={{ fontSize: "11px", fontWeight: "700", color: NAVY }}>{order.larguraCm} cm</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #eee", paddingTop: "3px" }}>
              <span style={{ fontSize: "8px", color: "#888" }}>Valor</span>
              <span style={{ fontSize: "13px", fontWeight: "900", color: "#059669" }}>{valor}</span>
            </div>
            {order.attachments.length > 0 && (
              <div style={{ borderTop: "1px solid #eee", marginTop: "3px", paddingTop: "3px" }}>
                <span style={{ fontSize: "7px", color: "#888" }}>Arquivos: {order.attachments.length} arquivo{order.attachments.length > 1 ? "s" : ""}</span>
              </div>
            )}
          </div>

          {order.observacao && (
            <div style={{ border: "1px solid #fde68a", borderRadius: "3px", padding: "3px 6px", marginBottom: "3mm", background: "#fffbeb" }}>
              <div style={{ fontSize: "7px", color: "#92400e", fontWeight: "700", marginBottom: "1px" }}>OBSERVAÇÃO</div>
              <div style={{ fontSize: "8px", color: "#78350f" }}>{order.observacao}</div>
            </div>
          )}

          <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
            <div style={{ fontSize: "7px", color: "#666" }}>Assinatura do cliente</div>
          </div>
        </div>
        <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
      </div>
    )
  }

  // A4
  return (
    <div className="hidden print:block fixed inset-0 bg-white z-[100]">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .dtf-a4, .dtf-a4 * { visibility: visible !important; }
          .dtf-a4 { position: fixed; top: 0; left: 0; right: 0; bottom: 0; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>
      <div className="dtf-a4">
        <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", height: "100%" }}>
          {(["LOJA", "CLIENTE"] as const).map(via => (
            <div key={via} style={{
              fontFamily: "'Arial', 'Helvetica', sans-serif",
              padding: "6mm 14mm 8mm 14mm", color: NAVY,
              borderBottom: via === "LOJA" ? "1px dashed #ccc" : undefined,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "5px" }}>
                <img src="/smsemfundo.png" alt="SM Confecções" style={{ height: "46px", width: "auto", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "16px", fontWeight: "900", letterSpacing: "-0.5px", lineHeight: 1, color: NAVY }}>SM CONFECÇÕES</div>
                  <div style={{ fontSize: "8px", color: "#666", marginTop: "3px" }}>Av. Santa Cruz, 3088 — Franca / SP</div>
                </div>
                <div style={{
                  background: "#7C3AED", color: "white",
                  borderRadius: "4px", padding: "3px 10px",
                  fontSize: "9px", fontWeight: "700", letterSpacing: "0.5px",
                }}>VIA {via}</div>
              </div>

              <div style={{
                background: NAVY, color: "white", borderRadius: "5px",
                padding: "5px 12px", marginBottom: "8px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontWeight: "800", fontSize: "11px", letterSpacing: "1px" }}>PEDIDO DTF</span>
                <span style={{ fontSize: "8px", opacity: 0.7 }}>Impressão: {printDate} {printTime}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div style={{ background: NAVY_LT, borderRadius: "5px", padding: "6px 10px" }}>
                  <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "3px" }}>Cliente</div>
                  <div style={{ fontSize: "13px", fontWeight: "800", color: NAVY, lineHeight: 1.2 }}>{nomeCliente}</div>
                  {order.contactPhone && <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>{order.contactPhone}</div>}
                </div>

                <div style={{ background: NAVY_LT, borderRadius: "5px", padding: "6px 10px" }}>
                  {([
                    ["Nº Pedido",      order.number],
                    ["Data do pedido", orderDate],
                    ["Impressão",      printTime],
                  ] as [string, string][]).map(([label, val], i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between",
                      paddingTop: i > 0 ? "3px" : 0,
                      marginTop: i > 0 ? "3px" : 0,
                      borderTop: i > 0 ? "1px solid #d8dde8" : undefined,
                    }}>
                      <span style={{ fontSize: "7px", color: "#888" }}>{label}</span>
                      <span style={{ fontSize: "8px", fontWeight: "700", color: NAVY }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}>
                <thead>
                  <tr style={{ background: NAVY, color: "white" }}>
                    <th style={{ padding: "5px 10px", textAlign: "left", fontSize: "8px", fontWeight: "700" }}>SERVIÇO</th>
                    <th style={{ padding: "5px 10px", textAlign: "center", fontSize: "8px", fontWeight: "700", width: "80px" }}>METRAGEM</th>
                    <th style={{ padding: "5px 10px", textAlign: "center", fontSize: "8px", fontWeight: "700", width: "60px" }}>LARGURA</th>
                    <th style={{ padding: "5px 10px", textAlign: "right", fontSize: "8px", fontWeight: "700", width: "90px" }}>VALOR</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: "white", borderBottom: "1px solid #e8eaf0" }}>
                    <td style={{ padding: "6px 10px", fontSize: "10px", fontWeight: "600" }}>
                      Impressão DTF
                      {order.attachments.length > 0 && (
                        <span style={{ fontSize: "8px", color: "#7C3AED", marginLeft: "6px" }}>
                          · {order.attachments.length} arquivo{order.attachments.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: "11px", fontWeight: "900", color: NAVY }}>
                      {metros ? `${Number(metros).toFixed(2)} m` : "—"}
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "center", fontSize: "10px", color: "#555" }}>
                      {order.larguraCm ? `${order.larguraCm} cm` : "—"}
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontSize: "13px", fontWeight: "900", color: "#059669" }}>
                      {valor}
                    </td>
                  </tr>
                </tbody>
              </table>

              {order.observacao && (
                <div style={{
                  border: "1px solid #fde68a", borderRadius: "5px",
                  padding: "5px 10px", marginBottom: "8px", background: "#fffbeb",
                }}>
                  <span style={{ fontSize: "8px", color: "#92400e", fontWeight: "700" }}>OBSERVAÇÃO: </span>
                  <span style={{ fontSize: "9px", color: "#78350f" }}>{order.observacao}</span>
                </div>
              )}

              <div style={{
                borderTop: "1px solid #d0d5e0", paddingTop: "6px",
                display: "flex", justifyContent: "space-between", alignItems: "flex-end",
              }}>
                <div>
                  <div style={{ fontSize: "7px", color: "#aaa", marginBottom: "12px" }}>Assinatura do cliente</div>
                  <div style={{ borderTop: "1px solid #aaa", width: "120px" }} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "7px", color: "#aaa" }}>SM Confecções · Av. Santa Cruz, 3088 · Franca/SP</div>
                  <div style={{ fontSize: "7px", color: "#aaa" }}>{order.number} · {printDate}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
    </div>
  )
}
