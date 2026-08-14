// Chave da memória de SKU exato — usada tanto na leitura (parse/route.ts)
// quanto na gravação (confirm/route.ts), por isso mora num lugar só: se as
// duas divergirem, a memória nunca dá match e a feature vira letra morta.
//
// SKU sozinho NÃO é confiável como chave: testado com picklist real de
// produção, o mesmo "SKU do Anúncio" apareceu 6x apontando pra 6 combinações
// de cor/tamanho diferentes (o vendedor reaproveita 1 SKU pra todas as
// variações de um produto — o mesmo padrão que já fazia a IA desconfiar do
// SKU sozinho no prompt de casamento). A Variação é o que de fato distingue
// a linha nesse caso, então ela entra na chave junto.
function normalize(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "")
}

export function buildMatchKey(sku: string, variacao: string): string {
  return `${normalize(sku)}::${normalize(variacao)}`
}
