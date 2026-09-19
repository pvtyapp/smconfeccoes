"use client"

import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"

export default function PasswordInput({
  value, onChange, id, label, placeholder, tooltip, autoComplete,
}: {
  value: string
  onChange: (v: string) => void
  id: string
  label: string
  placeholder?: string
  tooltip?: string
  autoComplete?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          title={tooltip}
          autoComplete={autoComplete}
          className="w-full border border-[#0F1E3C]/15 rounded-xl pl-4 pr-11 py-3 text-sm text-[#0F1E3C] placeholder:text-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          title={show ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/35 hover:text-[#0F1E3C]/60"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  )
}
