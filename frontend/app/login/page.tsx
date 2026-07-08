"use client"

import Image from "next/image"
import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { fetchAndStoreSession } from "@/lib/auth"
import { firstAllowedPage } from "@/lib/navPages"

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [login, setLoginField] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      })
      if (res.ok) {
        const session = await fetchAndStoreSession()
        const from = searchParams.get("from")
        const canGoFrom = from && session && (session.isAdmin || session.allowedPages.some(p => from === p || from.startsWith(p + "/")))
        const fallback = session ? (firstAllowedPage(session.isAdmin, session.allowedPages) ?? "/sem-acesso") : "/sem-acesso"
        router.push(canGoFrom ? from : fallback)
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? "Login ou senha incorretos.")
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0A1628] flex items-center justify-center px-5">
      {/* Grid texture */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/smsemfundo.png"
            alt="SM Confecções"
            width={120}
            height={60}
            className="brightness-0 invert object-contain mb-5"
          />
          <h1
            className="text-2xl font-black text-white text-center"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            SM Confecções
          </h1>
          <p className="text-sm text-white/40 mt-1">Acesso ao painel interno</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 border border-white/10 backdrop-blur-sm rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                Login
              </label>
              <input
                type="text"
                value={login}
                onChange={(e) => setLoginField(e.target.value)}
                placeholder="seu usuário"
                required
                autoCapitalize="none"
                className="w-full bg-white/8 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/50 focus:border-[#4361EE] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                Senha
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-white/8 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/50 focus:border-[#4361EE] transition-colors"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#4361EE] hover:bg-[#3451D4] text-white font-bold py-3 rounded-xl transition-all hover:scale-[1.01] mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
