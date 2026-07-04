"use client"

import { AlertTriangle, Clock, Download, Printer } from "lucide-react"

export type DtfAttachment = { id: number; blobUrl: string; filename: string | null; mimeType: string | null }

export type DtfOrder = {
  id: number
  number: string
  data: string
  cliente: string | null
  metros: number | null
  metrosFinais: number | null
  larguraCm: number | null
  precoCobrado: number | null
  observacao: string | null
  status: string
  source: string
  dueDate: string | null
  isPaid: boolean | null
  impressoraId: number | null
  contactId: number | null
  contactName: string | null
  contactPhone: string | null
  contactJid: string | null
  paymentTermEnabled: boolean
  paymentTermType: string | null
  paymentTermDays: number | null
  createdAt: string
  attachments: DtfAttachment[]
}

const STATUS_LABEL: Record<string, string> = {
  triagem:      "Triagem",
  em_producao:  "Em Produção",
  pronto:       "Pronto p/ Retirada",
  concluido:    "Concluído",
  cancelado:    "Cancelado",
}

const STATUS_COLOR: Record<string, string> = {
  triagem:     "bg-amber-50 text-amber-700 border-amber-200",
  em_producao: "bg-blue-50 text-blue-700 border-blue-200",
  pronto:      "bg-green-50 text-green-700 border-green-200",
  concluido:   "bg-[#0F1E3C]/5 text-[#0F1E3C]/40 border-[#0F1E3C]/10",
  cancelado:   "bg-red-50 text-red-600 border-red-200",
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "agora"
  if (mins < 60) return `${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

type Props = { order: DtfOrder; onClick: () => void }

export default function DtfOrderCard({ order, onClick }: Props) {
  const nomeCliente = order.contactName ?? order.cliente ?? "Cliente não identificado"

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-[#0F1E3C]/8 p-4 shadow-sm hover:shadow-md hover:border-[#7C3AED]/30 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Printer size={12} className="text-[#7C3AED]" />
            <p className="text-sm font-bold text-[#0F1E3C]">{order.number}</p>
          </div>
          <p className="text-xs text-[#0F1E3C]/45 mt-0.5">{nomeCliente}</p>
          {order.contactPhone && (
            <p className="text-[10px] text-[#0F1E3C]/30">{order.contactPhone}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[order.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
            {STATUS_LABEL[order.status] ?? order.status}
          </span>
          <div className="flex items-center gap-1 text-[10px] text-[#0F1E3C]/30">
            <Clock size={9} />
            {timeAgo(order.createdAt)}
          </div>
        </div>
      </div>

      <div className="space-y-1 text-xs">
        {order.metros && (
          <div className="flex justify-between">
            <span className="text-[#0F1E3C]/50">Metros pedidos</span>
            <span className="font-semibold">{Number(order.metros).toFixed(2)} m</span>
          </div>
        )}
        {order.metrosFinais && (
          <div className="flex justify-between">
            <span className="text-[#0F1E3C]/50">Metros finais</span>
            <span className="font-bold text-[#7C3AED]">{Number(order.metrosFinais).toFixed(2)} m</span>
          </div>
        )}
        {order.larguraCm && (
          <div className="flex justify-between">
            <span className="text-[#0F1E3C]/50">Largura</span>
            <span className="font-semibold">{order.larguraCm} cm</span>
          </div>
        )}
        {order.precoCobrado && (
          <div className="flex justify-between">
            <span className="text-[#0F1E3C]/50">Valor</span>
            <span className="font-bold text-emerald-600">R$ {Number(order.precoCobrado).toFixed(2).replace(".", ",")}</span>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-[#0F1E3C]/6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {order.attachments.length === 0 ? (
            <>
              <AlertTriangle size={10} className="text-amber-500" />
              <span className="text-[10px] text-amber-600 font-semibold">Aguardando arquivo</span>
            </>
          ) : (
            <>
              <Download size={10} className="text-[#7C3AED]" />
              <span className="text-[10px] text-[#7C3AED] font-semibold">
                {order.attachments.length} arquivo{order.attachments.length !== 1 ? "s" : ""}
              </span>
            </>
          )}
        </div>
        {order.status === "em_producao" && order.impressoraId != null && (
          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
            🖨 Imp. {order.impressoraId}
          </span>
        )}
        {(order.status === "pronto" || order.status === "concluido") && order.isPaid !== null && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            order.isPaid
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          }`}>
            {order.isPaid ? "Pago" : "A cobrar"}
          </span>
        )}
      </div>
    </button>
  )
}
