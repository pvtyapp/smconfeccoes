"use client"

import { useEffect, useRef, useState } from "react"

// Entrar com WhatsApp + código, sem senha (PIV 05/11: "o usuário é muito burro,
// não lê direito"). Dois passos, uma pergunta por tela, letra grande, o código
// confere sozinho quando o 6º número é digitado.
export type EntrarResultado =
  | { tipo: "logado"; name: string }
  | { tipo: "novo"; token: string; phone: string }

function mascara(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11)
  if (d.length > 6) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return d
}

export default function EntrarFlow({ titulo, onFim }: { titulo?: string; onFim: (r: EntrarResultado) => void }) {
  const [etapa, setEtapa] = useState<"fone" | "codigo">("fone")
  const [fone, setFone] = useState("")
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

  async function pedirCodigo() {
    setErro("")
    if (fone.replace(/\D/g, "").length < 10) { setErro("Falta número. Coloca o DDD e o número do WhatsApp."); return }
    setBusy(true)
    try {
      const res = await fetch("/api/portal/auth/entrar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "codigo", phone: fone }),
      })
      const data = await res.json()
      if (!res.ok) { setErro(data.error ?? "Não deu pra mandar o código agora."); return }
      setCodigo(["", "", "", "", "", ""])
      setEtapa("codigo")
      setEspera(60)
      setTimeout(() => refs.current[0]?.focus(), 50)
    } catch {
      setErro("Sem internet? Tenta de novo.")
    } finally {
      setBusy(false)
    }
  }

  async function confirmar(cod: string) {
    setErro("")
    setBusy(true)
    try {
      const res = await fetch("/api/portal/auth/entrar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "confirmar", phone: fone, code: cod }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErro(data.error ?? "Código errado.")
        setCodigo(["", "", "", "", "", ""])
        setTimeout(() => refs.current[0]?.focus(), 50)
        return
      }
      if (data.novo) onFim({ tipo: "novo", token: data.token, phone: fone })
      else onFim({ tipo: "logado", name: data.name })
    } catch {
      setErro("Sem internet? Tenta de novo.")
    } finally {
      setBusy(false)
    }
  }

  function digita(i: number, v: string) {
    const nums = v.replace(/\D/g, "")
    const novo = [...codigo]
    if (nums.length > 1) {
      // colou o código inteiro (ou o celular preencheu sozinho)
      nums.slice(0, 6).split("").forEach((n, k) => { if (i + k < 6) novo[i + k] = n })
    } else {
      novo[i] = nums
    }
    setCodigo(novo)
    const prox = novo.findIndex((n) => !n)
    if (prox === -1) confirmar(novo.join(""))
    else if (nums) refs.current[Math.min(prox, 5)]?.focus()
  }

  if (etapa === "fone") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <p className="tit">{titulo ?? "Qual seu WhatsApp?"}</p>
        <p className="obs">A gente manda um código de 6 números no seu WhatsApp. Não precisa de senha.</p>
        <div className="fld">
          <label htmlFor="entrar-fone">Seu WhatsApp com DDD</label>
          <input
            id="entrar-fone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(16) 99999-9999"
            value={fone} onChange={(e) => setFone(mascara(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter") pedirCodigo() }}
            autoFocus
          />
        </div>
        {erro && <p className="erro">{erro}</p>}
        <button className="btn azul grande" type="button" onClick={pedirCodigo} disabled={busy}>
          {busy ? "Mandando…" : "Mandar código no WhatsApp"}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p className="tit">Olha seu WhatsApp</p>
      <p className="obs">Mandamos um código de 6 números pro <b>{fone}</b>. Digita ele aqui:</p>
      <div className="otp">
        {codigo.map((n, i) => (
          <input
            key={i} ref={(el) => { refs.current[i] = el }}
            inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} aria-label={`Número ${i + 1} do código`}
            value={n} disabled={busy}
            onChange={(e) => digita(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Backspace" && !codigo[i] && i > 0) refs.current[i - 1]?.focus() }}
          />
        ))}
      </div>
      {busy && <p className="obs">Conferindo…</p>}
      {erro && <p className="erro">{erro}</p>}
      {espera > 0
        ? <p className="obs">Não chegou? Dá pra pedir outro em {espera}s.</p>
        : <button className="link" type="button" onClick={pedirCodigo}>Não chegou? Mandar outro código</button>}
      <button className="link" type="button" onClick={() => { setEtapa("fone"); setErro("") }}>Errei o número</button>
    </div>
  )
}
