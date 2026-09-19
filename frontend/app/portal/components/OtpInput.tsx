"use client"

import { useRef } from "react"

export default function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(6, " ").split("").slice(0, 6)

  function setDigit(idx: number, char: string) {
    const clean = char.replace(/\D/g, "").slice(-1)
    const next = digits.slice()
    next[idx] = clean || " "
    onChange(next.join("").trimEnd())
    if (clean && idx < 5) refs.current[idx + 1]?.focus()
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
    if (pasted) {
      e.preventDefault()
      onChange(pasted)
      refs.current[Math.min(pasted.length, 5)]?.focus()
    }
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">Código de verificação</label>
      <div className="flex gap-2" onPaste={handlePaste} role="group" aria-label="Código de verificação, 6 dígitos">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            aria-label={`Dígito ${i + 1} de 6`}
            value={d.trim()}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i].trim() && i > 0) refs.current[i - 1]?.focus()
            }}
            className="w-11 h-12 text-center text-lg font-bold border border-[#0F1E3C]/15 rounded-xl text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
          />
        ))}
      </div>
      <p className="text-[11px] text-[#0F1E3C]/40 mt-1.5">Chega em até 1 minuto, confira o WhatsApp.</p>
    </div>
  )
}
