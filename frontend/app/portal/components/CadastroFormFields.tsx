"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { UserPlus, ArrowLeft } from "lucide-react"
import WhatsAppInput from "./WhatsAppInput"
import PasswordInput from "./PasswordInput"
import OtpInput from "./OtpInput"

export default function CadastroFormFields({ next = "/portal", idPrefix = "cad" }: { next?: string; idPrefix?: string }) {
  const router = useRouter()
  const [step, setStep] = useState<"dados" | "confirmar">("dados")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (!name.trim()) { setError("Informe seu nome"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/portal/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: "signup" }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível enviar o código"); return }
      setStep("confirmar")
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setLoading(false)
    }
  }

  async function handleSignup(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (password !== confirmPassword) { setError("As senhas não coincidem"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/portal/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, code, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível criar a conta"); return }
      router.push(next)
      router.refresh()
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setLoading(false)
    }
  }

  if (step === "dados") {
    return (
      <form onSubmit={handleRequestCode} className="space-y-4">
        <div>
          <label htmlFor={`${idPrefix}-name`} className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">Nome</label>
          <input
            id={`${idPrefix}-name`} type="text" required value={name} onChange={(e) => setName(e.target.value)}
            className="w-full border border-[#0F1E3C]/15 rounded-xl px-4 py-3 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
          />
        </div>
        <WhatsAppInput id={`${idPrefix}-phone`} value={phone} onChange={setPhone} />

        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

        <button
          type="submit" disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {loading ? "Enviando código..." : "Receber código no WhatsApp"}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSignup} className="space-y-4">
      <button
        type="button" onClick={() => setStep("dados")}
        className="inline-flex items-center gap-1.5 text-xs text-[#0F1E3C]/40 hover:text-[#0F1E3C]/70 -mt-1 mb-1"
      >
        <ArrowLeft size={12} /> Corrigir WhatsApp
      </button>

      <OtpInput value={code} onChange={setCode} />
      <PasswordInput id={`${idPrefix}-password`} label="Senha" value={password} onChange={setPassword}
        tooltip="Pode ser a senha que quiser, sem regra de tamanho ou caractere especial" autoComplete="new-password" />
      <PasswordInput id={`${idPrefix}-confirm`} label="Confirmar senha" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />

      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

      <button
        type="submit" disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
      >
        <UserPlus size={16} />
        {loading ? "Criando conta..." : "Criar conta"}
      </button>
    </form>
  )
}
