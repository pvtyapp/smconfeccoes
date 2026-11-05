"use client"

import { useEffect, useRef, useState } from "react"

// Entrar (WhatsApp + senha) ou criar conta (nome + WhatsApp + senha → código no
// WhatsApp → conta ativa na hora). PIV 05/11: "o usuário é muito burro, não lê
// direito" → letra grande, uma coisa por vez, código confere sozinho no 6º número.
export type AcessoResultado = { tipo: "logado"; name: string } | { tipo: "pendente" }
type Carrinho = { itens: { variantId: string; qty: number }[]; dtfMetros: number }

function mascara(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11)
  if (d.length > 6) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return d
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  return { res, data: await res.json().catch(() => ({})) }
}

export default function AcessoFlow({ inicio = "entrar", carrinho, onFim }: {
  inicio?: "entrar" | "criar"
  carrinho?: Carrinho
  onFim: (r: AcessoResultado) => void
}) {
  const [modo, setModo] = useState<"entrar" | "criar" | "codigo">(inicio)
  const [nome, setNome] = useState("")
  const [fone, setFone] = useState("")
  const [senha, setSenha] = useState("")
  const [ver, setVer] = useState(false)
  const [codigo, setCodigo] = useState(["", "", "", "", "", ""])
  const [erro, setErro] = useState("")
  const [busy, setBusy] = useState(false)
  const [espera, setEspera] = useState(0)
  const refs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (espera <= 0) return
    const t = setTimeout(() => setEspera((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [espera])

  const foneOk = fone.replace(/\D/g, "").length >= 10

  async function entrar() {
    setErro("")
    if (!foneOk) { setErro("Coloca o DDD e o número do WhatsApp."); return }
    if (!senha) { setErro("Coloca sua senha."); return }
    setBusy(true)
    try {
      const { res, data } = await post("/api/portal/auth/login", { phone: fone, password: senha })
      if (!res.ok) { setErro(data.error ?? "WhatsApp ou senha errados."); return }
      onFim({ tipo: "logado", name: data.name })
    } catch { setErro("Sem internet? Tenta de novo.") } finally { setBusy(false) }
  }

  async function mandarCodigo() {
    setErro("")
    if (!nome.trim()) { setErro("Escreve seu nome."); return }
    if (!foneOk) { setErro("Coloca o DDD e o número do WhatsApp."); return }
    if (senha.length < 4) { setErro("A senha precisa ter pelo menos 4 letras ou números."); return }
    setBusy(true)
    try {
      const { res, data } = await post("/api/portal/auth/request-code", { phone: fone, purpose: "signup", name: nome })
      if (res.status === 409) { setModo("entrar"); setErro("Esse WhatsApp já tem conta. É só entrar com sua senha."); return }
      if (!res.ok) { setErro(data.error ?? "Não deu pra mandar o código agora."); return }
      setCodigo(["", "", "", "", "", ""]); setModo("codigo"); setEspera(60)
      setTimeout(() => refs.current[0]?.focus(), 50)
    } catch { setErro("Sem internet? Tenta de novo.") } finally { setBusy(false) }
  }

  async function confirmar(cod: string) {
    setErro(""); setBusy(true)
    try {
      const { res, data } = await post("/api/portal/auth/signup", {
        name: nome, phone: fone, code: cod, password: senha, itens: carrinho?.itens ?? [], dtfMetros: carrinho?.dtfMetros ?? 0,
      })
      if (!res.ok) {
        setErro(data.error ?? "Código errado."); setCodigo(["", "", "", "", "", ""])
        setTimeout(() => refs.current[0]?.focus(), 50); return
      }
      onFim(data.pending ? { tipo: "pendente" } : { tipo: "logado", name: data.name })
    } catch { setErro("Sem internet? Tenta de novo.") } finally { setBusy(false) }
  }

  function digita(i: number, v: string) {
    const nums = v.replace(/\D/g, "")
    const novo = [...codigo]
    if (nums.length > 1) nums.slice(0, 6).split("").forEach((n, k) => { if (i + k < 6) novo[i + k] = n })
    else novo[i] = nums
    setCodigo(novo)
    const prox = novo.findIndex((n) => !n)
    if (prox === -1) confirmar(novo.join(""))
    else if (nums) refs.current[Math.min(prox, 5)]?.focus()
  }

  if (modo === "codigo") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <p className="tit">Olha seu WhatsApp</p>
        <p className="obs">Mandamos um código de 6 números pro <b>{fone}</b>. Digita ele aqui pra ativar sua conta:</p>
        <div className="otp">
          {codigo.map((n, i) => (
            <input key={i} ref={(el) => { refs.current[i] = el }} inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"} aria-label={`Número ${i + 1} do código`}
              value={n} disabled={busy} onChange={(e) => digita(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Backspace" && !codigo[i] && i > 0) refs.current[i - 1]?.focus() }} />
          ))}
        </div>
        {busy && <p className="obs">Conferindo…</p>}
        {erro && <p className="erro">{erro}</p>}
        {espera > 0
          ? <p className="obs">Não chegou? Dá pra pedir outro em {espera}s.</p>
          : <button className="link" type="button" onClick={mandarCodigo}>Não chegou? Mandar outro código</button>}
        <button className="link" type="button" onClick={() => { setModo("criar"); setErro("") }}>Errei o número</button>
      </div>
    )
  }

  const criando = modo === "criar"
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="abas" role="tablist">
        <button type="button" role="tab" aria-selected={!criando} onClick={() => { setModo("entrar"); setErro("") }}>Já tenho conta</button>
        <button type="button" role="tab" aria-selected={criando} onClick={() => { setModo("criar"); setErro("") }}>Criar conta</button>
      </div>
      {criando && (
        <div className="fld">
          <label htmlFor="ac-nome">Seu nome</label>
          <input id="ac-nome" type="text" autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
      )}
      <div className="fld">
        <label htmlFor="ac-fone">Seu WhatsApp com DDD</label>
        <input id="ac-fone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(16) 99999-9999"
          value={fone} onChange={(e) => setFone(mascara(e.target.value))} />
      </div>
      <div className="fld">
        <label htmlFor="ac-senha">{criando ? "Crie uma senha" : "Sua senha"}</label>
        <div className="senha">
          <input id="ac-senha" type={ver ? "text" : "password"} autoComplete={criando ? "new-password" : "current-password"}
            value={senha} onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (criando ? mandarCodigo() : entrar()) }} />
          <button type="button" onClick={() => setVer((v) => !v)}>{ver ? "esconder" : "mostrar"}</button>
        </div>
      </div>
      {erro && <p className="erro">{erro}</p>}
      {criando ? (
        <>
          <button className="btn azul grande" type="button" onClick={mandarCodigo} disabled={busy}>{busy ? "Mandando…" : "Criar conta"}</button>
          <p className="obs">Vai chegar um código no seu WhatsApp pra confirmar que o número é seu.</p>
        </>
      ) : (
        <>
          <button className="btn azul grande" type="button" onClick={entrar} disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
          <a className="link" href="/portal/esqueci-senha">Esqueci minha senha</a>
        </>
      )}
    </div>
  )
}
