import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"

export type SessionPayload = {
  userId: number
  login: string
  name: string
  isAdmin: boolean
  allowedPages: string[]
}

const COOKIE_NAME = "smc_session"
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 dias

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET não configurado no servidor")
  return new TextEncoder().encode(secret)
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecretKey())
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (
      typeof payload.userId !== "number" ||
      typeof payload.login !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.isAdmin !== "boolean" ||
      !Array.isArray(payload.allowedPages)
    ) {
      return null
    }
    return {
      userId: payload.userId,
      login: payload.login,
      name: payload.name,
      isAdmin: payload.isAdmin,
      allowedPages: payload.allowedPages as string[],
    }
  } catch {
    return null
  }
}

// Lê e valida a sessão do cookie da requisição atual — uso em rotas de API que
// precisam saber quem está logado (ex: checar se é admin antes de mexer em usuários).
export async function getSessionFromRequest(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null
  return verifySession(token)
}

export { COOKIE_NAME, MAX_AGE_SECONDS }
