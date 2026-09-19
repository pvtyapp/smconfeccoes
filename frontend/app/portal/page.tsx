import { redirect } from "next/navigation"
import Image from "next/image"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import LogoutButton from "./LogoutButton"

// Fase 1 — só a conta funcionando. Catálogo, carrinho, Meus Pedidos e Meus
// Dados chegam nas fases seguintes (ver artifact "Portal do Cliente SM").
export default async function PortalHomePage() {
  const session = await getClientSessionFromRequest()
  if (!session) redirect("/portal/login")

  return (
    <div className="min-h-screen bg-[#F4F6FB]" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
      <header className="bg-white border-b border-[#0F1E3C]/8 px-6 py-4 flex items-center justify-between">
        <Image src="/smsemfundo.png" alt="SM Confecções" width={110} height={55} className="w-[90px] h-auto" />
        <LogoutButton />
      </header>
      <main className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-3xl font-black text-[#0F1E3C] mb-2" style={{ fontFamily: "var(--font-playfair)" }}>
          Olá, {session.name.split(" ")[0]}!
        </h1>
        <p className="text-[#0F1E3C]/50">Sua conta está pronta. O catálogo chega em breve por aqui.</p>
      </main>
    </div>
  )
}
