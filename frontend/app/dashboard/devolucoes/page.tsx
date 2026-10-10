"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Search, X, Trash2, Pencil, Loader2, Undo2 } from "lucide-react"
import { todayBR } from "@/lib/tz"
import {
  LOJAS_DEVOLUCAO, SITUACOES_DEVOLUCAO,
  type Devolucao, type LojaDevolucao, type SituacaoDevolucao,
} from "@/lib/devolucoes"

// ─── Visual ───────────────────────────────────────────────────────────────────

const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
const cellInputCls = "w-full bg-transparent border border-transparent hover:border-[#0F1E3C]/12 focus:border-[#4361EE]/40 rounded-lg px-2 py-1 text-xs text-[#0F1E3C] focus:outline-none focus:bg-white"

const COR_SITUACAO: Record<SituacaoDevolucao, string> = {
  "A caminho":  "bg-amber-50 text-amber-700 border-amber-200",
  "Disponível": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Reservada":  "bg-blue-50 text-blue-700 border-blue-200",
  "Usada":      "bg-slate-100 text-slate-600 border-slate-200",
  "Descartada": "bg-rose-50 text-rose-700 border-rose-200",
  "Não volta":  "bg-zinc-100 text-zinc-500 border-zinc-200",
}

const fmtData = (d: string) => d ? d.split("-").reverse().join("/") : "—"

type Form = {
  data: string; loja: LojaDevolucao; numeroDevolucao: string; pedido: string; sku: string
  produto: string; cor: string; tamanho: string; quantidade: number; motivo: string
  situacao: SituacaoDevolucao; pedidoReservado: string; observacao: string
}
const formVazio = (): Form => ({
  data: todayBR(), loja: "MARI", numeroDevolucao: "", pedido: "", sku: "", produto: "", cor: "", tamanho: "",
  quantidade: 1, motivo: "", situacao: "A caminho", pedidoReservado: "", observacao: "",
})
const formDe = (d: Devolucao): Form => ({
  data: d.data, loja: d.loja, numeroDevolucao: d.numeroDevolucao ?? "", pedido: d.pedido ?? "", sku: d.sku,
  produto: d.produto ?? "", cor: d.cor ?? "", tamanho: d.tamanho ?? "", quantidade: d.quantidade, motivo: d.motivo ?? "",
  situacao: d.situacao, pedidoReservado: d.pedidoReservado ?? "", observacao: d.observacao ?? "",
})

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DevolucoesPage() {
  const [lista, setLista] = useState<Devolucao[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState("")
  const [filtroSituacao, setFiltroSituacao] = useState("")
  const [filtroLoja, setFiltroLoja] = useState("")
  const [busca, setBusca] = useState("")

  const [modal, setModal] = useState<{ id: number | null; form: Form } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState("")

  // carrega tudo uma vez; filtros e contadores rodam na tela (lista é pequena)
  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/devolucoes")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "erro ao carregar")
      setLista(j); setErro("")
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const contadores = useMemo(() => {
    const c: Record<string, number> = {}
    for (const d of lista) if (!filtroLoja || d.loja === filtroLoja) c[d.situacao] = (c[d.situacao] || 0) + d.quantidade
    return c
  }, [lista, filtroLoja])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter(d =>
      (!filtroSituacao || d.situacao === filtroSituacao) &&
      (!filtroLoja || d.loja === filtroLoja) &&
      (!q || [d.sku, d.produto, d.pedido, d.numeroDevolucao, d.pedidoReservado].some(x => (x || "").toLowerCase().includes(q))))
  }, [lista, filtroSituacao, filtroLoja, busca])

  // edição direto na linha: grava só o campo que mudou
  async function salvarCampo(d: Devolucao, campo: keyof Form, valor: string) {
    if (((d as unknown as Record<string, unknown>)[campo] ?? "") === valor) return
    const antes = lista
    setLista(l => l.map(x => x.id === d.id ? { ...x, [campo]: valor || null } : x))
    try {
      const r = await fetch(`/api/devolucoes/${d.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [campo]: valor }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "erro ao salvar")
      setLista(l => l.map(x => x.id === d.id ? j.devolucao : x))
    } catch (e) { setLista(antes); alert(e instanceof Error ? e.message : String(e)) }
  }

  async function apagar(d: Devolucao) {
    if (!confirm(`Apagar a devolução ${d.sku}${d.numeroDevolucao ? ` (${d.numeroDevolucao})` : ""}?`)) return
    const r = await fetch(`/api/devolucoes/${d.id}`, { method: "DELETE" })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { alert(j.error || "erro ao apagar"); return }
    setLista(l => l.filter(x => x.id !== d.id))
  }

  async function salvarModal() {
    if (!modal) return
    if (!modal.form.sku.trim()) { setErroModal("SKU é obrigatório"); return }
    setSalvando(true); setErroModal("")
    try {
      const novo = modal.id === null
      const corpo = novo ? { ...modal.form, origem: "manual" } : modal.form
      const r = await fetch(novo ? "/api/devolucoes" : `/api/devolucoes/${modal.id}`, {
        method: novo ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "erro ao salvar")
      if (j.duplicada) { setErroModal("Já existe uma devolução com esse número e SKU (pode ter sido apagada)."); return }
      setModal(null); await carregar()
    } catch (e) { setErroModal(e instanceof Error ? e.message : String(e)) }
    finally { setSalvando(false) }
  }

  const setF = <K extends keyof Form>(k: K, v: Form[K]) => setModal(m => m ? { ...m, form: { ...m.form, [k]: v } } : m)

  return (
    <div className="max-w-[1500px] space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Devoluções</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5 max-w-2xl">
            Peças devolvidas pelos clientes da Shopee e do TikTok, pra reaproveitar em pedidos novos.
          </p>
        </div>
        <button onClick={() => { setModal({ id: null, form: formVazio() }); setErroModal("") }} data-testid="dev-adicionar"
          className="flex items-center gap-2 bg-[#0F1E3C] text-white text-sm font-semibold rounded-xl px-4 py-2.5 shadow-sm hover:bg-[#0F1E3C]/90">
          <Plus size={15} /> Adicionar devolução
        </button>
      </div>

      {/* Contadores por situação (clicar filtra) */}
      <div className="flex flex-wrap gap-2" data-testid="dev-contadores">
        {SITUACOES_DEVOLUCAO.map(s => {
          const ativo = filtroSituacao === s
          return (
            <button key={s} onClick={() => setFiltroSituacao(ativo ? "" : s)}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${COR_SITUACAO[s]} ${ativo ? "ring-2 ring-[#4361EE]/40" : "opacity-90 hover:opacity-100"}`}>
              {s} <span className="tabular-nums font-black">{contadores[s] || 0}</span>
            </button>
          )
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por SKU, produto ou pedido"
            className="w-full bg-white border border-[#0F1E3C]/10 rounded-xl pl-10 pr-9 py-2.5 text-sm text-[#0F1E3C] placeholder:text-[#0F1E3C]/30 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
          {busca && (
            <button onClick={() => setBusca("")} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30 hover:text-[#0F1E3C]"><X size={14} /></button>
          )}
        </div>
        <select value={filtroSituacao} onChange={e => setFiltroSituacao(e.target.value)} className="bg-white border border-[#0F1E3C]/10 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] shadow-sm">
          <option value="">Todas as situações</option>
          {SITUACOES_DEVOLUCAO.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filtroLoja} onChange={e => setFiltroLoja(e.target.value)} className="bg-white border border-[#0F1E3C]/10 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] shadow-sm">
          <option value="">Todas as lojas</option>
          {LOJAS_DEVOLUCAO.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#0F1E3C]/40"><Loader2 size={16} className="animate-spin" /> Carregando…</div>
        ) : erro ? (
          <p className="py-12 text-center text-sm text-rose-600">{erro}</p>
        ) : visiveis.length === 0 ? (
          <div className="py-14 text-center text-sm text-[#0F1E3C]/40">
            <Undo2 size={22} className="mx-auto mb-2 opacity-40" />
            {lista.length ? "Nenhuma devolução com esse filtro." : "Nenhuma devolução lançada ainda."}
          </div>
        ) : (
          <table className="w-full text-xs" data-testid="dev-tabela">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[#0F1E3C]/40 border-b border-[#0F1E3C]/8">
                {["Data", "Loja", "SKU", "Produto", "Cor", "Tam.", "Qtd", "Situação", "Pedido reservado", "Observação", "Nº devolução", "Pedido", "Motivo", "Origem"].map(h =>
                  <th key={h} className="px-3 py-3 font-bold whitespace-nowrap">{h}</th>)}
                <th className="sticky right-0 bg-white px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map(d => (
                <tr key={d.id} className="border-b border-[#0F1E3C]/5 last:border-0 hover:bg-[#0F1E3C]/[0.015] align-top group">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtData(d.data)}</td>
                  <td className="px-3 py-2 font-semibold">{d.loja}</td>
                  <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">{d.sku}</td>
                  <td className="px-3 py-2 min-w-[150px]">{d.produto || "—"}</td>
                  <td className="px-3 py-2">{d.cor || "—"}</td>
                  <td className="px-3 py-2">{d.tamanho || "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-center font-bold">{d.quantidade}</td>
                  <td className="px-3 py-2">
                    <select value={d.situacao} onChange={e => salvarCampo(d, "situacao", e.target.value)} data-testid={`dev-situacao-${d.id}`}
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold ${COR_SITUACAO[d.situacao]}`}>
                      {SITUACOES_DEVOLUCAO.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 min-w-[130px]">
                    <input defaultValue={d.pedidoReservado ?? ""} key={`pr-${d.id}-${d.pedidoReservado}`} placeholder="—"
                      onBlur={e => salvarCampo(d, "pedidoReservado", e.target.value.trim())}
                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                      className={cellInputCls} />
                  </td>
                  <td className="px-2 py-1.5 min-w-[200px]">
                    <textarea defaultValue={d.observacao ?? ""} key={`ob-${d.id}-${d.observacao}`} placeholder="anotar…" rows={1}
                      onBlur={e => salvarCampo(d, "observacao", e.target.value.trim())}
                      className={`${cellInputCls} resize-y min-h-[28px]`} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[#0F1E3C]/60">{d.numeroDevolucao || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{d.pedido || "—"}</td>
                  <td className="px-3 py-2 min-w-[120px] text-[#0F1E3C]/60">{d.motivo || "—"}</td>
                  <td className="px-3 py-2 text-[#0F1E3C]/45">{d.origem === "robo" ? "robô" : "manual"}</td>
                  <td className="sticky right-0 bg-white px-2 py-1.5 whitespace-nowrap shadow-[-6px_0_8px_-6px_rgba(15,30,60,0.12)]">
                    <button onClick={() => { setModal({ id: d.id, form: formDe(d) }); setErroModal("") }} aria-label="Editar"
                      className="p-1.5 rounded-lg text-[#0F1E3C]/35 hover:text-[#4361EE] hover:bg-[#4361EE]/8"><Pencil size={13} /></button>
                    <button onClick={() => apagar(d)} aria-label="Apagar"
                      className="p-1.5 rounded-lg text-[#0F1E3C]/35 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: adicionar / editar */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !salvando && setModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
              <h2 className="font-black text-[#0F1E3C]">{modal.id === null ? "Adicionar devolução" : "Editar devolução"}</h2>
              <button onClick={() => setModal(null)} aria-label="Fechar" className="text-[#0F1E3C]/40 hover:text-[#0F1E3C]"><X size={18} /></button>
            </div>
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Campo label="Data"><input type="date" value={modal.form.data} onChange={e => setF("data", e.target.value)} className={inputCls} /></Campo>
              <Campo label="Loja">
                <select value={modal.form.loja} onChange={e => setF("loja", e.target.value as LojaDevolucao)} className={inputCls}>
                  {LOJAS_DEVOLUCAO.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </Campo>
              <Campo label="Situação">
                <select value={modal.form.situacao} onChange={e => setF("situacao", e.target.value as SituacaoDevolucao)} className={inputCls}>
                  {SITUACOES_DEVOLUCAO.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Campo>
              <Campo label="SKU *" full><input value={modal.form.sku} onChange={e => setF("sku", e.target.value)} placeholder="ex.: cami_gracas4x-Bege-P" className={`${inputCls} font-mono`} /></Campo>
              <Campo label="Produto" full><input value={modal.form.produto} onChange={e => setF("produto", e.target.value)} className={inputCls} /></Campo>
              <Campo label="Cor"><input value={modal.form.cor} onChange={e => setF("cor", e.target.value)} className={inputCls} /></Campo>
              <Campo label="Tamanho"><input value={modal.form.tamanho} onChange={e => setF("tamanho", e.target.value)} className={inputCls} /></Campo>
              <Campo label="Quantidade"><input type="number" min={1} value={modal.form.quantidade} onChange={e => setF("quantidade", Math.max(1, parseInt(e.target.value) || 1))} className={inputCls} /></Campo>
              <Campo label="Nº da devolução"><input value={modal.form.numeroDevolucao} onChange={e => setF("numeroDevolucao", e.target.value)} placeholder="da plataforma" className={inputCls} /></Campo>
              <Campo label="Pedido"><input value={modal.form.pedido} onChange={e => setF("pedido", e.target.value)} placeholder="nº ou #UP" className={inputCls} /></Campo>
              <Campo label="Pedido reservado"><input value={modal.form.pedidoReservado} onChange={e => setF("pedidoReservado", e.target.value)} className={inputCls} /></Campo>
              <Campo label="Motivo" full><input value={modal.form.motivo} onChange={e => setF("motivo", e.target.value)} className={inputCls} /></Campo>
              <Campo label="Observação" full><textarea value={modal.form.observacao} onChange={e => setF("observacao", e.target.value)} rows={3} className={`${inputCls} resize-y`} /></Campo>
            </div>
            {erroModal && <p className="px-5 pb-2 text-sm text-rose-600">{erroModal}</p>}
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#0F1E3C]/8">
              <button onClick={() => setModal(null)} disabled={salvando} className="px-4 py-2 rounded-xl text-sm font-semibold text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/6">Cancelar</button>
              <button onClick={salvarModal} disabled={salvando} data-testid="dev-salvar"
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-[#0F1E3C] text-white hover:bg-[#0F1E3C]/90 disabled:opacity-50">
                {salvando && <Loader2 size={14} className="animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Campo({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${full ? "col-span-2 sm:col-span-3" : ""}`}>
      <span className="text-[11px] font-bold text-[#0F1E3C]/50">{label}</span>
      {children}
    </label>
  )
}
