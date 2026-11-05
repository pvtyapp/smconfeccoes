import { SignJWT, jwtVerify } from "jose"

// Prova de que o WhatsApp acabou de passar no código (PIV 05/11, site novo).
// Quem confirma o código e não tem conta segue pro passo "nome + onde vende"
// sem digitar código de novo: o /api/portal/auth/entrar devolve este token e
// o /api/portal/solicitacao exige ele. Vale 30 min, mesmo AUTH_SECRET da sessão.
const TTL_SECONDS = 30 * 60

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET não configurado no servidor")
  return new TextEncoder().encode(secret)
}

export async function signVerifiedPhone(phone: string): Promise<string> {
  return new SignJWT({ phone, kind: "verified_phone" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecretKey())
}

export async function readVerifiedPhone(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (payload.kind !== "verified_phone" || typeof payload.phone !== "string") return null
    return payload.phone
  } catch {
    return null
  }
}
