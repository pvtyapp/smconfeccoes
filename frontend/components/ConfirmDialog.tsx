"use client"

type Props = {
  title: string
  confirmLabel?: string
  confirming?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ title, confirmLabel = "Sim, avançar", confirming, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold text-[#0F1E3C]">{title}</h3>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={confirming}
            className="flex-1 px-4 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6 disabled:opacity-50">
            Não
          </button>
          <button onClick={onConfirm} disabled={confirming}
            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">
            {confirming ? "..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
