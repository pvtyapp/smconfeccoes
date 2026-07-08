"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import { logout } from "@/lib/auth"

export default function SemAcessoPage() {
  const router = useRouter()

  async function handleLogout() {
    await logout()
    router.push("/login")
  }

  return (
    <div className="min-h-screen bg-[#0A1628] flex items-center justify-center px-5">
      <div className="relative w-full max-w-sm text-center">
        <div className="flex flex-col items-center mb-6">
          <Image
            src="/smsemfundo.png"
            alt="SM Confecções"
            width={100}
            height={50}
            className="brightness-0 invert object-contain mb-5"
          />
        </div>
        <div className="bg-white/5 border border-white/10 backdrop-blur-sm rounded-2xl p-8 space-y-4">
          <h1 className="text-lg font-black text-white">Sem acesso liberado</h1>
          <p className="text-sm text-white/50">
            Sua conta ainda não tem nenhuma página liberada. Fale com o administrador
            do sistema pra ele liberar o acesso que você precisa.
          </p>
          <button
            onClick={handleLogout}
            className="w-full bg-[#4361EE] hover:bg-[#3451D4] text-white font-bold py-3 rounded-xl transition-all mt-2"
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  )
}
