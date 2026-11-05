"use client"

import "@/components/site/site.css"
import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import EntrarFlow from "@/components/site/EntrarFlow"
import LoginFormFields from "../components/LoginFormFields"

export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  )
}

// Entrar só com WhatsApp + código (PIV 05/11). A senha antiga continua
// funcionando pra quem prefere, escondida num link pequeno.
function LoginPageContent() {
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/portal"
  const [comSenha, setComSenha] = useState(false)
  const [novo, setNovo] = useState(false)

  return (
    <div className="smsite entrar-pg">
      <div className="entrar-box">
        <Link href="/" aria-label="Voltar pro site"><img src="/smsemfundo.png" alt="SM Confecções" style={{ width: 120, height: "auto" }} /></Link>
        {novo ? (
          <>
            <p className="tit">Você ainda não tem cadastro</p>
            <p className="obs">É só escolher as peças no site e mandar o pedido: a gente faz seu cadastro junto, no mesmo passo.</p>
            <Link className="btn azul grande" href="/#pecas">Ver peças</Link>
          </>
        ) : comSenha ? (
          <>
            <p className="tit">Entrar com senha</p>
            <LoginFormFields next={next} idPrefix="login" />
            <button className="link" type="button" onClick={() => setComSenha(false)}>← Entrar com código no WhatsApp</button>
          </>
        ) : (
          <>
            <EntrarFlow onFim={(r) => { if (r.tipo === "logado") window.location.href = next; else setNovo(true) }} />
            <button className="link" type="button" onClick={() => setComSenha(true)}>Prefiro usar minha senha</button>
          </>
        )}
      </div>
    </div>
  )
}
