// Validação por dígito verificador (decisão do formulário: não só formato).

export function isValidCpf(raw: string): boolean {
  const cpf = raw.replace(/\D/g, "")
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i)
  let check = (sum * 10) % 11
  if (check === 10) check = 0
  if (check !== Number(cpf[9])) return false
  sum = 0
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i)
  check = (sum * 10) % 11
  if (check === 10) check = 0
  return check === Number(cpf[10])
}

export function isValidCnpj(raw: string): boolean {
  const cnpj = raw.replace(/\D/g, "")
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i]
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  if (calc(12) !== Number(cnpj[12])) return false
  return calc(13) === Number(cnpj[13])
}

export function isValidDocument(raw: string, tipo: "fisica" | "juridica"): boolean {
  return tipo === "juridica" ? isValidCnpj(raw) : isValidCpf(raw)
}
