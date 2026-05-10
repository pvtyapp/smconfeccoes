"use client"

import Image from "next/image"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { login } from "@/lib/auth"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (login(email, password)) {
      router.push("/dashboard")
    } else {
      setError("Email ou senha incorretos.")
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
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dev@smconfeccoes.app"
                required
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
              className="w-full bg-[#4361EE] hover:bg-[#3451D4] text-white font-bold py-3 rounded-xl transition-all hover:scale-[1.01] mt-2"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
