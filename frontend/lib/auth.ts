import type { AuthSession } from "./types"

const SESSION_KEY = "smc_auth_session"

const VALID_CREDENTIALS = {
  email: "dev@smconfeccoes.app",
  password: "10203040",
}

export function login(email: string, password: string): boolean {
  if (email === VALID_CREDENTIALS.email && password === VALID_CREDENTIALS.password) {
    const session: AuthSession = {
      email: "dev@smconfeccoes.app",
      role: "admin",
      name: "Administrador",
      company: "SM Confecções",
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return true
  }
  return false
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY)
}

export function getSession(): AuthSession | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthSession
  } catch {
    return null
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null
}
