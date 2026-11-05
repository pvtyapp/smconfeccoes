"use client"

import "./site.css"
import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import AcessoFlow from "./AcessoFlow"

// /portal/login e /portal/cadastro usam a mesma tela do site novo (PIV 05/11):
// entrar com WhatsApp + senha, ou criar conta e confirmar o código no WhatsApp.
export default function AcessoPagina({ inicio }: { inicio: "entrar" | "criar" }) {
  return <Suspense fallback={null}><Conteudo inicio={inicio} /></Suspense>
}

function Conteudo({ inicio }: { inicio: "entrar" | "criar" }) {
  const next = useSearchParams().get("next") || "/portal"
  const [pendente, setPendente] = useState(false)
  return (
    <div className="smsite entrar-pg">
      <div className="entrar-box">
        <Link href="/" aria-label="Voltar pro site"><img src="/smsemfundo.png" alt="SM Confecções" style={{ width: 120, height: "auto" }} /></Link>
        {pendente ? (
          <>
            <p className="tit">Cadastro recebido</p>
            <p className="obs">Nossa equipe confere seu cadastro e te avisa no WhatsApp assim que liberar.</p>
            <Link className="btn azul grande" href="/">Voltar pro site</Link>
          </>
        ) : (
          <AcessoFlow inicio={inicio} onFim={(r) => { if (r.tipo === "logado") window.location.href = next; else setPendente(true) }} />
        )}
      </div>
    </div>
  )
}
