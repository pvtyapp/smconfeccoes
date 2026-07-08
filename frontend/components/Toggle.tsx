"use client"

// Toggle liga/desliga único, reutilizado em todo o sistema — antes existiam 4 cópias
// levemente diferentes desse mesmo botão espalhadas pelo código, e 3 delas tinham a
// matemática errada (bolinha não ficava simétrica entre ligado/desligado). Essa é a
// única versão certa: trilho 40×22, bolinha 18×18, 2px de folga dos dois lados.
export default function Toggle({ on, onChange, onColor = "bg-[#4361EE]", disabled = false }: {
  on: boolean
  onChange: () => void
  onColor?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative w-10 h-[22px] rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${on ? onColor : "bg-[#0F1E3C]/15"}`}
    >
      <span
        className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  )
}
