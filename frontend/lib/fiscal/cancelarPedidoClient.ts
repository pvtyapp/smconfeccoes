// Cancelar pedido pela tela (Kanban, Relatório de Vendas, Clientes a Receber).
// Se o pedido tem nota fiscal que pede confirmação (fora das 24h ou nota que
// cobre outros pedidos), pergunta ao operador e reenvia confirmado. Qualquer
// erro aparece num alerta: antes o erro era ignorado e parecia que tinha
// cancelado. Devolve true se o pedido foi cancelado.
export async function cancelarPedido(url: string, body: Record<string, unknown>): Promise<boolean> {
  const enviar = (extra: Record<string, unknown> = {}) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, status: "cancelado", ...extra }),
  })
  let res = await enviar()
  let data = await res.json().catch(() => ({}))
  if (res.status === 409 && data.code === "confirmar_nota") {
    if (!window.confirm(data.error)) return false
    res = await enviar({ confirmarNota: true })
    data = await res.json().catch(() => ({}))
  }
  if (!res.ok) {
    window.alert(data.error || "Não foi possível cancelar o pedido.")
    return false
  }
  if (data.avisoNota) window.alert(data.avisoNota)
  return true
}
