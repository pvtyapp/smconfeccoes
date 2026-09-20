// Regra de negócio (decisão do dono, 2026-09-20): nota fiscal não é emitida
// pra Pessoa Física nem pra MEI — só Jurídica com regime Simples Nacional /
// Lucro Presumido / Lucro Real precisa (e é obrigada a ter) endereço e
// documento completos. Módulo puro (sem import de banco) pra poder validar
// tanto no cliente (Meus Dados, feedback na hora) quanto no servidor
// (bloqueio de verdade — PATCH do perfil e checkout).

export const REGIMES_TRIBUTARIOS = [
  { value: "mei", label: "MEI" },
  { value: "simples_nacional", label: "Simples Nacional" },
  { value: "lucro_presumido", label: "Lucro Presumido" },
  { value: "lucro_real", label: "Lucro Real" },
] as const

export type RegimeTributario = typeof REGIMES_TRIBUTARIOS[number]["value"]

export type FiscalContact = {
  tipoPessoa: "fisica" | "juridica" | null
  cpfCnpj: string | null
  razaoSocial: string | null
  regimeTributario: string | null
  inscricaoEstadual: string | null
  ieIsento: boolean
  cep: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  codigoMunicipioIbge: string | null
}

// MEI nunca emite nota por aqui — mesma regra pra pessoa física (que nem
// tem regime tributário pra começo de conversa).
export function isNfeEligible(c: Pick<FiscalContact, "tipoPessoa" | "regimeTributario">): boolean {
  return c.tipoPessoa === "juridica" && !!c.regimeTributario && c.regimeTributario !== "mei"
}

// Lista em português, pronta pra mostrar pro cliente — cada item já é o
// nome do campo que falta, não um código técnico.
export function missingFiscalFields(c: FiscalContact): string[] {
  const missing: string[] = []

  if (c.tipoPessoa !== "fisica" && c.tipoPessoa !== "juridica") {
    return ["tipo de pessoa (física ou jurídica)"]
  }

  if (c.tipoPessoa === "fisica") {
    if (!c.cpfCnpj) missing.push("CPF")
    return missing
  }

  // Jurídica a partir daqui.
  if (!c.cpfCnpj) missing.push("CNPJ")
  if (!c.razaoSocial) missing.push("razão social")
  if (!c.regimeTributario) {
    missing.push("regime tributário")
    return missing // sem regime não dá pra saber se precisa do resto (MEI não precisa)
  }
  if (c.regimeTributario === "mei") return missing // MEI para por aqui — não emite nota

  if (!c.inscricaoEstadual && !c.ieIsento) missing.push("Inscrição Estadual (ou marcar como isento)")
  if (!c.cep) missing.push("CEP")
  if (!c.logradouro) missing.push("logradouro")
  if (!c.numero) missing.push("número")
  if (!c.bairro) missing.push("bairro")
  if (!c.cidade) missing.push("cidade")
  if (!c.uf) missing.push("UF")
  if (!c.codigoMunicipioIbge) missing.push("código IBGE do município (preenchido sozinho pelo CEP)")

  return missing
}
