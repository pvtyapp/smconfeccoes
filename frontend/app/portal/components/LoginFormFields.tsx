"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { LogIn } from "lucide-react"
import WhatsAppInput from "./WhatsAppInput"
import PasswordInput from "./PasswordInput"

export default function LoginFormFields({ next = "/portal", idPrefix = "login" }: { next?: string; idPrefix?: string }) {
  const router = useRouter()
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/portal/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível entrar"); return }
      router.push(next)
      router.refresh()
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <WhatsAppInput id={`${idPrefix}-phone`} value={phone} onChange={setPhone} />
      <PasswordInput id={`${idPrefix}-password`} label="Senha" value={password} onChange={setPassword} autoComplete="current-password" />

      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
      >
        <LogIn size={16} />
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  )
}
