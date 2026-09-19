"use client"

import { Suspense, useState, type FormEvent } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { LogIn } from "lucide-react"
import WhatsAppInput from "../components/WhatsAppInput"
import PasswordInput from "../components/PasswordInput"

export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/portal"
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
    <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center px-5 py-12" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Image src="/smsemfundo.png" alt="SM Confecções" width={160} height={80} className="w-[140px] h-auto" />
        </div>

        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-8">
          <h1 className="text-xl font-black text-[#0F1E3C] mb-1" style={{ fontFamily: "var(--font-playfair)" }}>
            Área do Cliente
          </h1>
          <p className="text-sm text-[#0F1E3C]/50 mb-6">Entre com seu WhatsApp e senha</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <WhatsAppInput id="login-phone" value={phone} onChange={setPhone} />
            <PasswordInput id="login-password" label="Senha" value={password} onChange={setPassword} autoComplete="current-password" />

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

          <div className="flex items-center justify-between mt-5 text-xs">
            <Link href={`/portal/esqueci-senha?next=${encodeURIComponent(next)}`} className="text-[#4361EE] font-semibold hover:underline">Esqueci minha senha</Link>
            <Link href={`/portal/cadastro?next=${encodeURIComponent(next)}`} className="text-[#4361EE] font-semibold hover:underline">Criar conta</Link>
          </div>
        </div>

        <p className="text-center text-xs text-[#0F1E3C]/30 mt-6">
          <Link href="/" className="hover:text-[#0F1E3C]/60">← Voltar pro site</Link>
        </p>
      </div>
    </div>
  )
}
