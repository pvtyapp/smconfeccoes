"use client"

import { Suspense } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import CadastroFormFields from "../components/CadastroFormFields"

export default function PortalCadastroPage() {
  return (
    <Suspense fallback={null}>
      <CadastroPageContent />
    </Suspense>
  )
}

function CadastroPageContent() {
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/portal"

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
          <p className="text-sm text-[#0F1E3C]/50 mb-6">Pra montar pedido pelo site, primeiro crie sua conta</p>

          <CadastroFormFields next={next} idPrefix="cad" />

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
