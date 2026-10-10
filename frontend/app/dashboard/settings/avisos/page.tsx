"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Send, Loader2, Paperclip, X, FileArchive } from "lucide-react"

const MAX_BYTES = 4 * 1024 * 1024   // a Vercel recusa corpo acima de ~4,5 MB
const fmtTam = (b: number) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

export default function AvisosPage() {
  const [text, setText] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const total = files.reduce((s, f) => s + f.size, 0)
  const grandeDemais = total > MAX_BYTES

  function addFiles(list: FileList | null) {
    if (!list?.length) return
    const novos = [...list]   // copia antes de limpar o input: o FileList esvazia junto
    setFiles(prev => {
      const nomes = new Set(prev.map(f => `${f.name}|${f.size}`))
      return [...prev, ...novos.filter(f => !nomes.has(`${f.name}|${f.size}`))]
    })
    setFeedback(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  async function send() {
    if ((!text.trim() && !files.length) || grandeDemais) return
    setSending(true)
    setFeedback(null)
    try {
      let r: Response
      if (files.length) {
        const fd = new FormData()
        fd.append("text", text)
        for (const f of files) fd.append("file", f)
        r = await fetch("/api/whatsapp/aviso-marketplace", { method: "POST", body: fd })
      } else {
        r = await fetch("/api/whatsapp/aviso-marketplace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        })
      }
      const d = await r.json().catch(() => ({ error: r.status === 413 ? "Arquivo grande demais (limite 4 MB)" : `Erro ${r.status}` })) as { ok?: boolean; error?: string }
      if (!r.ok) {
        setFeedback({ ok: false, msg: d.error ?? "Erro ao enviar" })
        return
      }
      setFeedback({ ok: true, msg: files.length ? `Enviado com ${files.length} arquivo${files.length > 1 ? "s" : ""}!` : "Enviado!" })
      setText("")
      setFiles([])
    } catch {
      setFeedback({ ok: false, msg: "Erro de conexão ao enviar" })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/dashboard/settings" className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0F1E3C]/40 hover:text-[#0F1E3C] mb-2">
          <ArrowLeft size={12} /> Configurações
        </Link>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Avisos</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Cola o texto de uma análise pronta e manda pro grupo SM Marketplaces, com arquivos se precisar</p>
      </div>

      <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
        <div>
          <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Mensagem</label>
          <textarea
            className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 transition-colors min-h-[220px] font-mono"
            value={text}
            onChange={e => { setText(e.target.value); setFeedback(null) }}
            placeholder="Cola aqui o texto pronto da análise..."
          />
          <p className="text-[10px] text-[#0F1E3C]/30 mt-1">Vai pro grupo SM Marketplaces, pela instância administrativa dedicada (não a comercial).</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Anexos</label>
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
            className="border border-dashed border-[#0F1E3C]/15 rounded-xl px-4 py-3 space-y-2">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2 bg-[#F4F6FB] rounded-lg px-3 py-2">
                <FileArchive size={14} className="text-[#4361EE] flex-shrink-0" />
                <span className="text-xs font-semibold text-[#0F1E3C] truncate flex-1">{f.name}</span>
                <span className="text-[10px] text-[#0F1E3C]/40 tabular-nums">{fmtTam(f.size)}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} aria-label={`Tirar ${f.name}`}
                  className="text-[#0F1E3C]/30 hover:text-red-500"><X size={13} /></button>
              </div>
            ))}
            <button onClick={() => inputRef.current?.click()} data-testid="aviso-anexar"
              className="flex items-center gap-1.5 text-xs font-bold text-[#4361EE] hover:underline">
              <Paperclip size={13} /> {files.length ? "Adicionar outro arquivo" : "Anexar arquivo (zip, pdf, planilha…)"}
            </button>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
          </div>
          <p className={`text-[10px] mt-1 ${grandeDemais ? "text-red-600 font-semibold" : "text-[#0F1E3C]/30"}`}>
            {grandeDemais
              ? `Total ${fmtTam(total)}: passa do limite de 4 MB. Tira algum arquivo ou compacta mais.`
              : `A mensagem vai primeiro e os arquivos logo depois, como documento. Limite: 4 MB no total${files.length ? ` (agora ${fmtTam(total)})` : ""}.`}
          </p>
        </div>

        {feedback && (
          <p className={`text-xs font-semibold ${feedback.ok ? "text-emerald-600" : "text-red-600"}`}>
            {feedback.ok ? "✓ " : "⚠ "}{feedback.msg}
          </p>
        )}

        <button
          onClick={send}
          disabled={sending || (!text.trim() && !files.length) || grandeDemais}
          className="flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {sending ? "Enviando..." : "Enviar"}
        </button>
      </section>
    </div>
  )
}
