"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { ShoppingBag, Package, UserCircle } from "lucide-react"
import LogoutButton from "./LogoutButton"
import OrdersTab from "./OrdersTab"
import DadosTab from "./DadosTab"

export default function PortalHub({ name }: { name: string }) {
  const [tab, setTab] = useState<"pedidos" | "dados">("pedidos")

  return (
    <div className="min-h-screen bg-[#F4F6FB]" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
      <header className="bg-white border-b border-[#0F1E3C]/8 px-5 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Image src="/smsemfundo.png" alt="SM Confecções" width={90} height={45} className="w-[80px] h-auto" />
          <LogoutButton />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Olá, {name.split(" ")[0]}!
          </h1>
          <Link href="/catalogo" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#4361EE] hover:underline mt-1">
            <ShoppingBag size={14} /> Ir pro catálogo
          </Link>
        </div>

        <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-sm font-semibold mb-6 bg-white">
          <button onClick={() => setTab("pedidos")}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-3 transition-colors ${tab === "pedidos" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
            <Package size={15} /> Meus Pedidos
          </button>
          <button onClick={() => setTab("dados")}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-3 transition-colors ${tab === "dados" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
            <UserCircle size={15} /> Meus Dados
          </button>
        </div>

        {tab === "pedidos" ? <OrdersTab /> : <DadosTab />}
      </main>
    </div>
  )
}
