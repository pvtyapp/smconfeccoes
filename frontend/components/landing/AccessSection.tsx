"use client"

import { useState } from "react"
import { LogIn, UserPlus, Building2 } from "lucide-react"
import LoginFormFields from "@/app/portal/components/LoginFormFields"
import CadastroFormFields from "@/app/portal/components/CadastroFormFields"
import FornecedorFormFields from "./FornecedorFormFields"

export default function AccessSection() {
  const [tab, setTab] = useState<"login" | "cadastro">("login")

  return (
    <section id="area-do-cliente" className="py-12 sm:py-16 px-5 bg-white">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8 sm:mb-10">
          <p className="text-[#4361EE] text-sm font-semibold uppercase tracking-[0.15em] mb-2">Área do Cliente</p>
          <h2
            className="text-2xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-2"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Monte seu pedido pelo site
          </h2>
          <p className="text-[#0F1E3C]/45 text-base sm:text-lg max-w-md mx-auto">
            Já tem conta? Entre. Primeira vez? Cria em menos de 1 minuto.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start max-w-3xl mx-auto">
          {/* Login / Criar conta — mesmo card, em abas */}
          <div className="bg-[#F4F6FB] border border-[#0F1E3C]/8 rounded-2xl p-6 sm:p-8">
            <div className="flex rounded-xl border border-[#0F1E3C]/12 overflow-hidden text-sm font-bold mb-6">
              <button
                type="button" onClick={() => setTab("login")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 transition-colors ${
                  tab === "login" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/5"
                }`}
              >
                <LogIn size={14} /> Entrar
              </button>
              <button
                type="button" onClick={() => setTab("cadastro")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 transition-colors ${
                  tab === "cadastro" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/5"
                }`}
              >
                <UserPlus size={14} /> Criar conta
              </button>
            </div>

            {tab === "login" ? (
              <LoginFormFields next="/portal" idPrefix="lp-login" />
            ) : (
              <CadastroFormFields next="/portal" idPrefix="lp-cad" />
            )}
          </div>

          {/* Solicitar acesso ao Fornecedor — formulário próprio, aprovação manual */}
          <div className="bg-[#0F1E3C] border border-[#0F1E3C] rounded-2xl p-6 sm:p-8">
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center mb-5">
              <Building2 size={19} className="text-[#93A8F4]" />
            </div>
            <h3 className="text-lg font-black text-white mb-1">Quero comprar com vocês</h3>
            <p className="text-sm text-white/50 mb-6">Esse formulário é pra gente ter controle de quem compra, pra nunca faltar estoque pra você e manter um ótimo atendimento. Conta seus canais de venda — a gente analisa e avisa pelo WhatsApp assim que liberar seu acesso.</p>
            <FornecedorFormFields idPrefix="lp-forn" />
          </div>
        </div>
      </div>
    </section>
  )
}
