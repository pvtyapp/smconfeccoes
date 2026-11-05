import type { PublicCatalogProduct } from "@/lib/catalog/getPublicCatalog"

export function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

// Cores e tamanhos na ordem em que o catálogo já entrega (tamanho segue o size_list do produto).
export function coresDo(p: PublicCatalogProduct): string[] {
  return [...new Set(p.variants.map((v) => v.color).filter((c): c is string => !!c))]
}

export function tamanhosDo(p: PublicCatalogProduct): string[] {
  return [...new Set(p.variants.map((v) => v.size).filter((s): s is string => !!s))]
}

// Foto de capa = primeira geral (sem cor); a tabela de medidas é a última foto
// cadastrada, mesmo critério do botão "Ver tabela de medidas" do catálogo antigo.
export function capaDo(p: PublicCatalogProduct): string | null {
  return (p.images.find((i) => i.color === null) ?? p.images[0])?.url ?? null
}

export function medidasDo(p: PublicCatalogProduct): string | null {
  const gerais = p.images.filter((i) => i.color === null)
  const lista = gerais.length ? gerais : p.images
  return lista.length > 1 ? lista[lista.length - 1].url : null
}
