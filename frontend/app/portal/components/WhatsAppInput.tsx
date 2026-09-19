"use client"

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

export default function WhatsAppInput({
  value, onChange, id, label = "WhatsApp",
}: {
  value: string
  onChange: (v: string) => void
  id: string
  label?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">{label}</label>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        required
        value={value}
        onChange={(e) => onChange(maskPhone(e.target.value))}
        placeholder="(00) 00000-0000"
        title="É pra esse número que mandamos o código de confirmação"
        className="w-full border border-[#0F1E3C]/15 rounded-xl px-4 py-3 text-sm text-[#0F1E3C] placeholder:text-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
      />
    </div>
  )
}
