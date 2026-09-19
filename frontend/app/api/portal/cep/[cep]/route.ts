import { NextResponse } from "next/server"

// Proxy do ViaCEP — decisão 8 do plano: código IBGE nunca é digitado, só
// chega junto com a busca do CEP. Server-side pra nunca depender de CORS
// do navegador do cliente.
export async function GET(_req: Request, { params }: { params: Promise<{ cep: string }> }) {
  try {
    const { cep } = await params
    const digits = cep.replace(/\D/g, "")
    if (digits.length !== 8) return NextResponse.json({ error: "CEP inválido" }, { status: 400 })

    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return NextResponse.json({ error: "Não foi possível buscar o CEP agora" }, { status: 502 })
    const data = await res.json()
    if (data.erro) return NextResponse.json({ error: "CEP não encontrado" }, { status: 404 })

    return NextResponse.json({
      logradouro: data.logradouro || "",
      bairro: data.bairro || "",
      cidade: data.localidade || "",
      uf: data.uf || "",
      codigoMunicipioIbge: data.ibge || "",
    })
  } catch {
    return NextResponse.json({ error: "Não foi possível buscar o CEP agora" }, { status: 502 })
  }
}
