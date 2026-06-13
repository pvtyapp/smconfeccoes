"use client"

import { useState, useEffect } from "react"
import { X, Download, Check, ChevronRight, AlertCircle, Loader2, FileImage } from "lucide-react"
import type { DtfOrder } from "./DtfOrderCard"

type Props = {
  order: DtfOrder
  onClose: () => void
  onRefresh: () => void
}

const STATUS_FLOW: Record<string, { next: string; label: string; color: string }> = {
  triagem:     { next: "em_producao", label: "Marcar Em Produção",    color: "bg-blue-600 hover:bg-blue-700"   },
  em_producao: { next: "pronto",      label: "Marcar Pronto",         color: "bg-green-600 hover:bg-green-700" },
}

export default function DtfOrderModal({ order, onClose, onRefresh }: Props) {
  const [downloading,   setDownloading]   = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [metrosFinais,  setMetrosFinais]  = useState(order.metrosFinais ? String(order.metrosFinais) : "")
  const [showConcluir,  setShowConcluir]  = useState(false)
  const [precoCobrado,  setPrecoCobrado]  = useState(order.precoCobrado ? String(order.precoCobrado) : "")
  const [precoPorMetro, setPrecoPorMetro] = useState<number | null>(null)
  const [dueDate,       setDueDate]       = useState("")
  const [usePrazo,      setUsePrazo]      = useState(order.paymentTermEnabled ?? false)
  const [error,         setError]         = useState("")
  const [showCancel,    setShowCancel]    = useState(false)
  const [notifyClient,  setNotifyClient]  = useState(true)
  const [cancelMsg,     setCancelMsg]     = useState(`Seu pedido DTF ${order.number} foi cancelado. Qualquer dúvida é só chamar.`)

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.ok ? r.json() : null)
      .then(s => { if (s?.dtf_preco_por_metro) setPrecoPorMetro(parseFloat(s.dtf_preco_por_metro)) })
      .catch(() => {})
  }, [])

  function handleMetrosChange(val: string) {
    setMetrosFinais(val)
    if (precoPorMetro && val) {
      const m = parseFloat(val)
      if (!isNaN(m) && m > 0) {
        setPrecoCobrado((m * precoPorMetro).toFixed(2))
      }
    }
  }

  const flow = STATUS_FLOW[order.status]
  const nomeCliente = order.contactName ?? order.cliente ?? "Cliente não identificado"

  async function downloadArtes() {
    setDownloading(true)
    try {
      const slug = nomeCliente.split(" ")[0]

      if (order.attachments.length === 1) {
        // Single file: fetch directly from public blob URL — no Vercel function proxy needed
        const att  = order.attachments[0]
        const ext  = att.filename?.split(".").pop()?.toLowerCase() ?? "png"
        const r    = await fetch(att.blobUrl)
        if (!r.ok) throw new Error("fetch failed")
        const blob = await r.blob()
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement("a")
        a.href     = url
        a.download = `${slug}-arte.${ext}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else {
        // Multiple files: API builds ZIP with renamed files
        const r = await fetch(`/api/dtf/pedidos/${order.id}/download`)
        if (!r.ok) throw new Error("download failed")
        const blob = await r.blob()
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement("a")
        a.href     = url
        a.download = `${slug}-artes.zip`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch { /* silent */ }
    finally { setDownloading(false) }
  }

  async function advanceStatus() {
    if (!flow) return
    setSaving(true)
    setError("")
    try {
      const body: Record<string, unknown> = { status: flow.next }
      if (metrosFinais) body.metrosFinais = parseFloat(metrosFinais)
      if (precoCobrado) body.precoCobrado = parseFloat(precoCobrado)
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

  async function concluir() {
    if (usePrazo && !dueDate) { setError("Informe a data de vencimento."); return }
    setSaving(true)
    setError("")
    try {
      const r = await fetch(`/api/dtf/pedidos/${order.id}/conclude`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metrosFinais: metrosFinais ? parseFloat(metrosFinais) : null,
          precoCobrado: precoCobrado ? parseFloat(precoCobrado) : null,
          dueDate: usePrazo ? dueDate : null,
        }),
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
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-[#7C3AED] bg-purple-100 px-2 py-0.5 rounded-full">DTF</span>
              <h2 className="text-base font-bold text-[#0F1E3C]">{order.number}</h2>
            </div>
            <p className="text-xs text-[#0F1E3C]/40">{nomeCliente} {order.contactPhone ? `· ${order.contactPhone}` : ""}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            {order.metros && (
              <div className="bg-[#F4F6FB] rounded-xl p-3">
                <p className="text-[10px] text-[#0F1E3C]/40 uppercase tracking-wider">Metros pedidos</p>
                <p className="text-lg font-black text-[#0F1E3C]">{Number(order.metros).toFixed(2)} m</p>
              </div>
            )}
            {order.larguraCm && (
              <div className="bg-[#F4F6FB] rounded-xl p-3">
                <p className="text-[10px] text-[#0F1E3C]/40 uppercase tracking-wider">Largura</p>
                <p className="text-lg font-black text-[#0F1E3C]">{order.larguraCm} cm</p>
              </div>
            )}
            {order.observacao && (
              <div className="col-span-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs text-amber-700 font-medium">Observação</p>
                <p className="text-xs text-amber-800 mt-0.5">{order.observacao}</p>
              </div>
            )}
          </div>

          {/* Metros + valor — visível em triagem, em_producao e pronto */}
          {(order.status === "triagem" || order.status === "em_producao" || order.status === "pronto") && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider block">
                {order.status === "triagem" ? "Metragem (após calcular)" : "Metros finais impresso"}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={metrosFinais}
                onChange={e => handleMetrosChange(e.target.value)}
                placeholder="Ex: 2.50"
                className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
              />
              {precoPorMetro && metrosFinais && !isNaN(parseFloat(metrosFinais)) && (
                <p className="text-[10px] text-[#0F1E3C]/40">
                  {parseFloat(metrosFinais).toFixed(2)} m × R$ {precoPorMetro.toFixed(2)}/m = <span className="font-bold text-[#0F1E3C]/70">R$ {(parseFloat(metrosFinais) * precoPorMetro).toFixed(2)}</span>
                </p>
              )}
            </div>
          )}

          {/* Arquivos da arte */}
          {order.attachments.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider">
                  Arquivos da Arte ({order.attachments.length})
                </p>
                <button
                  onClick={downloadArtes}
                  disabled={downloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-50"
                >
                  {downloading
                    ? <><Loader2 size={11} className="animate-spin" /> Baixando...</>
                    : <><Download size={11} /> {order.attachments.length > 1 ? `Baixar ZIP (${order.attachments.length})` : "Baixar renomeado"}</>}
                </button>
              </div>
              <div className="space-y-1.5">
                {order.attachments.map((a, i) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 px-3 py-2.5 bg-[#F4F6FB] border border-[#0F1E3C]/8 rounded-xl"
                  >
                    <FileImage size={13} className="text-[#7C3AED] flex-shrink-0" />
                    <span className="text-xs font-medium text-[#0F1E3C] truncate flex-1">
                      {a.filename ?? `arquivo-${i + 1}`}
                    </span>
                    <span className="text-[10px] text-[#0F1E3C]/25 flex-shrink-0 uppercase">
                      {a.mimeType?.split("/")[1] ?? "bin"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {order.attachments.length === 0 && order.status === "triagem" && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} className="text-amber-600 flex-shrink-0" />
              <p className="text-xs text-amber-700">Nenhum arquivo recebido ainda. Aguardando envio do cliente.</p>
            </div>
          )}

          {/* Concluir form */}
          {showConcluir && (
            <div className="border border-[#0F1E3C]/10 rounded-2xl p-4 space-y-4 bg-[#F4F6FB]">
              <p className="text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-widest">Concluir Pedido</p>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider block">Metros finais</label>
                <input
                  type="number" step="0.01" min="0"
                  value={metrosFinais}
                  onChange={e => handleMetrosChange(e.target.value)}
                  placeholder="Ex: 2.50"
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                />
                {precoPorMetro && metrosFinais && !isNaN(parseFloat(metrosFinais)) && (
                  <p className="text-[10px] text-[#0F1E3C]/40">
                    {parseFloat(metrosFinais).toFixed(2)} m × R$ {precoPorMetro.toFixed(2)}/m = <span className="font-bold text-[#0F1E3C]/70">R$ {(parseFloat(metrosFinais) * precoPorMetro).toFixed(2)}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Valor cobrado (R$)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={precoCobrado}
                  onChange={e => setPrecoCobrado(e.target.value)}
                  placeholder="Ex: 29,98"
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                />
                <p className="text-[10px] text-[#0F1E3C]/30 mt-1">Calculado automaticamente. Edite se precisar cobrar diferente.</p>
              </div>

              {/* Prazo toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setUsePrazo(v => !v)}
                  className={`relative w-10 rounded-full transition-colors flex-shrink-0 ${usePrazo ? "bg-amber-500" : "bg-[#0F1E3C]/15"}`}
                  style={{ height: "22px" }}
                >
                  <span className={`absolute top-0.5 bg-white rounded-full shadow transition-transform ${usePrazo ? "translate-x-5" : "translate-x-0.5"}`} style={{ width: "18px", height: "18px" }} />
                </button>
                <p className="text-sm font-semibold text-[#0F1E3C]">Pagamento a prazo</p>
              </div>

              {usePrazo ? (
                <div>
                  <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Data de vencimento *</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full border border-amber-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-emerald-700">O cliente será notificado com o valor e a chave Pix cadastrada.</p>
                </div>
              )}

              {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

              <div className="flex gap-2">
                <button onClick={concluir} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50">
                  <Check size={14} /> Confirmar Conclusão
                </button>
                <button onClick={() => { setShowConcluir(false); setError("") }}
                  className="px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {error && !showConcluir && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#0F1E3C]/8 space-y-2">
          <div className="flex gap-2">
            {order.status !== "concluido" && order.status !== "cancelado" && (
              <button onClick={() => setShowCancel(true)} disabled={saving}
                className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors">
                Cancelar
              </button>
            )}

            {order.status === "pronto" && !showConcluir && (
              <button onClick={() => setShowConcluir(true)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-bold rounded-xl transition-colors">
                <Check size={14} /> Concluir Pedido
              </button>
            )}

            {flow && !showConcluir && (
              <button onClick={advanceStatus} disabled={saving}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors ${flow.color}`}>
                <Check size={14} /> {flow.label} <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cancel dialog */}
      {showCancel && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-[#0F1E3C]">Cancelar pedido {order.number}?</h3>

            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setNotifyClient(v => !v)}
                className={`relative w-10 rounded-full transition-colors flex-shrink-0 ${notifyClient ? "bg-[#4361EE]" : "bg-[#0F1E3C]/15"}`}
                style={{ height: "22px" }}>
                <span className={`absolute top-0.5 bg-white rounded-full shadow transition-transform ${notifyClient ? "translate-x-5" : "translate-x-0.5"}`} style={{ width: "18px", height: "18px" }} />
              </button>
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
              <button onClick={() => setShowCancel(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 transition-colors">
                Voltar
              </button>
              <button onClick={confirmCancelDtf} disabled={saving}
                className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50">
                {saving ? "..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
