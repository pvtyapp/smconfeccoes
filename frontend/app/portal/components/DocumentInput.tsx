"use client"

function maskCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11)
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2")
}
function maskCnpj(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14)
  return d.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2")
}

export default function DocumentInput({
  value, onChange, tipo, id,
}: {
  value: string
  onChange: (v: string) => void
  tipo: "fisica" | "juridica"
  id: string
}) {
  const mask = tipo === "juridica" ? maskCnpj : maskCpf
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">{tipo === "juridica" ? "CNPJ" : "CPF"}</label>
      <input
        id={id} type="text" inputMode="numeric" value={value}
        onChange={(e) => onChange(mask(e.target.value))}
        title="Necessário pra emitir a nota do seu pedido"
        placeholder={tipo === "juridica" ? "00.000.000/0000-00" : "000.000.000-00"}
        className="w-full border border-[#0F1E3C]/15 rounded-xl px-4 py-3 text-sm text-[#0F1E3C] placeholder:text-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
      />
    </div>
  )
}
