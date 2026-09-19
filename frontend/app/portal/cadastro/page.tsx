"use client"

import { Suspense, useState, type FormEvent } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { UserPlus, ArrowLeft } from "lucide-react"
import WhatsAppInput from "../components/WhatsAppInput"
import PasswordInput from "../components/PasswordInput"
import OtpInput from "../components/OtpInput"

export default function PortalCadastroPage() {
  return (
    <Suspense fallback={null}>
      <CadastroForm />
    </Suspense>
  )
}

function CadastroForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/portal"
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

  return (
    <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center px-5 py-12" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Image src="/smsemfundo.png" alt="SM Confecções" width={160} height={80} className="w-[140px] h-auto" />
        </div>

        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-8">
          <h1 className="text-xl font-black text-[#0F1E3C] mb-1" style={{ fontFamily: "var(--font-playfair)" }}>
            Criar conta
          </h1>
          <p className="text-sm text-[#0F1E3C]/50 mb-6">
            {step === "dados" ? "Pra montar pedido pelo site, primeiro crie sua conta" : "Confirme o código que mandamos e escolha sua senha"}
          </p>

          {step === "dados" ? (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div>
                <label htmlFor="cad-name" className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">Nome</label>
                <input
                  id="cad-name" type="text" required value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full border border-[#0F1E3C]/15 rounded-xl px-4 py-3 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"
                />
              </div>
              <WhatsAppInput id="cad-phone" value={phone} onChange={setPhone} />

              {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

              <button
                type="submit" disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
              >
                {loading ? "Enviando código..." : "Receber código no WhatsApp"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <button
                type="button" onClick={() => setStep("dados")}
                className="inline-flex items-center gap-1.5 text-xs text-[#0F1E3C]/40 hover:text-[#0F1E3C]/70 -mt-1 mb-1"
              >
                <ArrowLeft size={12} /> Corrigir WhatsApp
              </button>

              <OtpInput value={code} onChange={setCode} />
              <PasswordInput id="cad-password" label="Senha" value={password} onChange={setPassword}
                tooltip="Pode ser a senha que quiser, sem regra de tamanho ou caractere especial" autoComplete="new-password" />
              <PasswordInput id="cad-confirm" label="Confirmar senha" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />

              {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

              <button
                type="submit" disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
              >
                <UserPlus size={16} />
                {loading ? "Criando conta..." : "Criar conta"}
              </button>
            </form>
          )}

          <p className="text-center text-xs mt-5">
            <Link href={`/portal/login?next=${encodeURIComponent(next)}`} className="text-[#4361EE] font-semibold hover:underline">Já tenho conta</Link>
          </p>
        </div>

        <p className="text-center text-xs text-[#0F1E3C]/30 mt-6">
          <Link href="/" className="hover:text-[#0F1E3C]/60">← Voltar pro site</Link>
        </p>
      </div>
    </div>
  )
}
