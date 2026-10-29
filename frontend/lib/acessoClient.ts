"use client"

import { useEffect, useState } from "react"
import { getSession, setLocalSession } from "@/lib/auth"
import type { AuthSession } from "@/lib/types"

// Lado da tela das permissões de valor (o servidor já apaga o dado: lib/acesso.ts).
// Começa pelo que ficou salvo no login e confere no /api/auth/me uma vez por
// carregamento, pra mudança feita na tela de Usuários valer sem sair e entrar.
export type AcessoTela = { isAdmin: boolean; verPreco: boolean; verFinanceiro: boolean; carregado: boolean }

let atual: AuthSession | null = null
let buscou = false
const ouvintes = new Set<() => void>()

function deSessao(s: AuthSession | null, carregado: boolean): AcessoTela {
  const admin = !!s?.isAdmin
  return {
    isAdmin: admin,
    verPreco: admin || s?.verPreco === true,
    verFinanceiro: admin || s?.verFinanceiro === true,
    carregado,
  }
}

function buscarUmaVez() {
  if (buscou) return
  buscou = true
  fetch("/api/auth/me")
    .then(r => (r.ok ? r.json() : null))
    .then((s: AuthSession | null) => {
      if (!s) return
      atual = s
      setLocalSession(s)
      ouvintes.forEach(f => f())
    })
    .catch(() => {})
}

export function useAcesso(): AcessoTela {
  const [estado, setEstado] = useState<AcessoTela>(() => deSessao(atual ?? getSession(), atual !== null))
  useEffect(() => {
    const ouvir = () => setEstado(deSessao(atual, true))
    ouvintes.add(ouvir)
    if (atual) ouvir()
    buscarUmaVez()
    return () => { ouvintes.delete(ouvir) }
  }, [])
  return estado
}

// "•••" no lugar do valor que o usuário não pode ver.
export const OCULTO = "•••"
