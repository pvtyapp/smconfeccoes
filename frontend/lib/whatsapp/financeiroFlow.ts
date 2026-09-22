import { pool } from "@/lib/db"
import { resolveAdminUser, VARIABLE_COST_CATEGORIES } from "@/lib/whatsapp/adminBot"
import { sendFinanceiro } from "@/lib/whatsapp/financeiroGroup"
import { buildFechamentoBlocks, type FechamentoExpense } from "@/lib/reports/fechamentoDiario"
import { todayBR } from "@/lib/tz"

// Conversa do grupo Financeiro — pergunta de despesa variável no fim do dia,
// seguida do fechamento. Diferente do bot administrativo (adminBot.ts), cujo
// estado é por PESSOA (users.wa_state): aqui o estado é por GRUPO, guardado em
// app_settings, porque qualquer admin no grupo pode responder a mesma pergunta.

function fmtMoney(n: number): string {
  return `R$ ${n.toFixed(2).replace(".", ",")}`
}

type FlowState = "aguardando_sim_nao" | "despesa_categoria" | "despesa_descricao" | "despesa_valor"

async function getFlowState(): Promise<{ state: FlowState | null; data: Record<string, unknown> }> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'financeiro_flow_state'`
  ).catch(() => ({ rows: [] as { value: string }[] }))
  if (!rows[0]?.value) return { state: null, data: {} }
  try {
    const parsed = JSON.parse(rows[0].value) as { state: FlowState | null; data: Record<string, unknown> }
    return { state: parsed.state ?? null, data: parsed.data ?? {} }
  } catch {
    return { state: null, data: {} }
  }
}

async function setFlowState(state: FlowState | null, data: Record<string, unknown> = {}): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('financeiro_flow_state', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ state, data })]
  )
}

async function runFechamento(expense: FechamentoExpense): Promise<void> {
  const blocks = await buildFechamentoBlocks(todayBR(), expense)
  for (const block of blocks) {
    await sendFinanceiro(block)
  }
}

// Dispara a pergunta do fim do dia — chamado pelo cron ~19h BRT. Idempotente:
// se já perguntou hoje (ou já tá no meio do fluxo hoje), não pergunta de novo.
export async function askDespesaQuestion(): Promise<void> {
  const { state, data } = await getFlowState()
  const today = todayBR()
  if (state !== null && data.date === today) {
    // Fluxo de hoje ficou travado (nunca respondido, ou resposta perdida por
    // algum motivo) — sem esse aviso o pulo era 100% silencioso e só se
    // percebia às 20h vendo o fechamento sair sem despesa.
    await sendFinanceiro(
      `⚠️ Não perguntei de novo porque o fluxo de hoje ainda tá parado em "${state}" — alguém não respondeu ou a resposta não foi processada. Se ainda quiser lançar despesa, responde agora; senão o fechamento das 20h sai sem despesa.`
    )
    return
  }
  await setFlowState("aguardando_sim_nao", { date: today })
  await sendFinanceiro("Teve despesa variável hoje?\n\n1 - Sim\n2 - Não")
}

// Chamado pelo cron ~20h BRT — prazo combinado com o usuário: se ninguém
// respondeu (ou o fluxo ficou parado no meio, respondendo categoria/descrição/
// valor), força o fechamento SEM despesa e limpa o estado. O fechamento sempre
// sai até esse horário, não importa o que aconteceu com a pergunta.
export async function forceFechamentoIfPending(): Promise<void> {
  const { state, data } = await getFlowState()
  const today = todayBR()
  if (state === null || data.date !== today) return
  await setFlowState(null, {})
  await runFechamento(null)
}

// Mensagem recebida no grupo Financeiro. Retorna true se foi consumida pelo
// fluxo (o webhook não deve tratar como comando de menu normal nesse caso).
export async function handleFinanceiroGroupMessage(
  content: string,
  senderJid: string,
  participantAlt: string,
  groupContext: { groupJid: string; instance: string }
): Promise<boolean> {
  const { state, data } = await getFlowState()
  if (state === null) return false

  const today = todayBR()
  if (data.date !== today) return false // pergunta de outro dia — o cron de 20h já limpa

  // Só admin cadastrado interage com o fluxo — sem isso qualquer um no grupo
  // lançaria despesa fake ou responderia por outra pessoa.
  const adminUser = await resolveAdminUser(senderJid, participantAlt, groupContext).catch(() => null)
  if (!adminUser) return false

  const text = content.trim()
  const lower = text.toLowerCase()

  if (state === "aguardando_sim_nao") {
    if (lower === "1" || lower === "sim") {
      await setFlowState("despesa_categoria", { date: today })
      await sendFinanceiro(`💸 *Despesa Variável*\n\nQual categoria?\n\n${VARIABLE_COST_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join("\n")}`)
      return true
    }
    if (lower === "2" || lower === "nao" || lower === "não") {
      await setFlowState(null, {})
      await runFechamento(null)
      return true
    }
    await sendFinanceiro("Não entendi. Responda *1* (sim) ou *2* (não).")
    return true
  }

  if (state === "despesa_categoria") {
    const n = parseInt(lower, 10)
    if (isNaN(n) || n < 1 || n > VARIABLE_COST_CATEGORIES.length) {
      await sendFinanceiro(`Não entendi. Responda o número da categoria (1 a ${VARIABLE_COST_CATEGORIES.length}).`)
      return true
    }
    await setFlowState("despesa_descricao", { date: today, category: VARIABLE_COST_CATEGORIES[n - 1] })
    await sendFinanceiro(`Categoria *${VARIABLE_COST_CATEGORIES[n - 1]}*. Qual a descrição da despesa?`)
    return true
  }

  if (state === "despesa_descricao") {
    if (!text) {
      await sendFinanceiro("Manda a descrição da despesa.")
      return true
    }
    await setFlowState("despesa_valor", { ...data, description: text })
    await sendFinanceiro("Qual o valor? (ex: 45.90)")
    return true
  }

  if (state === "despesa_valor") {
    const amount = parseFloat(text.replace(",", "."))
    if (isNaN(amount) || amount <= 0) {
      await sendFinanceiro("Valor não reconhecido. Manda só o número (ex: 45.90).")
      return true
    }
    const category = data.category as string
    const description = data.description as string
    try {
      await pool.query(`
        INSERT INTO variable_costs (description, category, amount, cost_date, notes)
        VALUES ($1, $2, $3, $4, 'Lançado via grupo Financeiro (WhatsApp)')
      `, [description, category, amount, today])
    } catch (e) {
      console.error("[financeiroFlow] lançar despesa falhou:", e instanceof Error ? e.message : e)
      await sendFinanceiro("Deu erro ao lançar a despesa — vou seguir com o fechamento mesmo assim, lança pelo painel depois.")
      await setFlowState(null, {})
      await runFechamento(null)
      return true
    }
    await setFlowState(null, {})
    await sendFinanceiro(`✅ Despesa lançada! ${category} — ${description}: ${fmtMoney(amount)}.`)
    await runFechamento({ category, description, amount })
    return true
  }

  return false
}
