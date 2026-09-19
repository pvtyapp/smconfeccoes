"use client"

import { Suspense, useState, type FormEvent } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { KeyRound, ArrowLeft } from "lucide-react"
import WhatsAppInput from "../components/WhatsAppInput"
import PasswordInput from "../components/PasswordInput"
import OtpInput from "../components/OtpInput"

export default function PortalEsqueciSenhaPage() {
  return (
    <Suspense fallback={null}>
      <EsqueciSenhaForm />
    </Suspense>
  )
}

function EsqueciSenhaForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/portal"
  const [step, setStep] = useState<"telefone" | "nova-senha">("telefone")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/portal/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: "reset_password" }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível enviar o código"); return }
      setStep("nova-senha")
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (password !== confirmPassword) { setError("As senhas não coincidem"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/portal/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível trocar a senha"); return }
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
            Esqueci minha senha
          </h1>
          <p className="text-sm text-[#0F1E3C]/50 mb-6">
            {step === "telefone" ? "Informe o WhatsApp da sua conta" : "Confirme o código e escolha a nova senha"}
          </p>

          {step === "telefone" ? (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <WhatsAppInput id="fp-phone" value={phone} onChange={setPhone} />

              {error && <p className="text-xs text-red-600">{error}</p>}

              <button
                type="submit" disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
              >
                {loading ? "Enviando código..." : "Receber código no WhatsApp"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <button
                type="button" onClick={() => setStep("telefone")}
                className="inline-flex items-center gap-1.5 text-xs text-[#0F1E3C]/40 hover:text-[#0F1E3C]/70 -mt-1 mb-1"
              >
                <ArrowLeft size={12} /> Corrigir WhatsApp
              </button>

              <OtpInput value={code} onChange={setCode} />
              <PasswordInput id="fp-password" label="Nova senha" value={password} onChange={setPassword} autoComplete="new-password" />
              <PasswordInput id="fp-confirm" label="Confirmar nova senha" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />

              {error && <p className="text-xs text-red-600">{error}</p>}

              <button
                type="submit" disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
              >
                <KeyRound size={16} />
                {loading ? "Salvando..." : "Trocar senha"}
              </button>
            </form>
          )}

          <p className="text-center text-xs mt-5">
            <Link href={`/portal/login?next=${encodeURIComponent(next)}`} className="text-[#4361EE] font-semibold hover:underline">Voltar pro login</Link>
          </p>
        </div>

        <p className="text-center text-xs text-[#0F1E3C]/30 mt-6">
          <Link href="/" className="hover:text-[#0F1E3C]/60">← Voltar pro site</Link>
        </p>
      </div>
    </div>
  )
}
