"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Send, Loader2, Paperclip, X, FileArchive } from "lucide-react"

const MAX_BYTES = 150 * 1024 * 1024   // por arquivo; vai direto pro smconfeccoes-backend (Railway), não pela Vercel
const fmtTam = (b: number) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

// Sobe 1 arquivo pro backend com o token do painel; XHR pra ter a porcentagem do upload.
function subirArquivo(url: string, token: string, f: File, onPct: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let msg = `erro ${xhr.status}`
      try { const d = JSON.parse(xhr.responseText); msg = d.detail || d.error || msg } catch {}
      reject(new Error(msg))
    }
    xhr.onerror = () => reject(new Error("falha de conexão com o servidor de arquivos"))
    const fd = new FormData()
    fd.append("file", f)
    xhr.send(fd)
  })
}

export default function AvisosPage() {
  const [text, setText] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [progresso, setProgresso] = useState<{ i: number; n: number; nome: string; pct: number } | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const total = files.reduce((s, f) => s + f.size, 0)
  const grandeDemais = files.some(f => f.size > MAX_BYTES)

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
    let textoFoi = false
    const foram: string[] = []
    try {
      // 1) a mensagem (caminho de sempre, pela Vercel)
      if (text.trim()) {
        const r = await fetch("/api/whatsapp/aviso-marketplace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        })
        const d = await r.json().catch(() => ({})) as { error?: string }
        if (!r.ok) { setFeedback({ ok: false, msg: d.error ?? "Erro ao enviar a mensagem" }); return }
        textoFoi = true
      }
      // 2) os arquivos, um por um, direto pro backend
      if (files.length) {
        const rt = await fetch("/api/whatsapp/aviso-marketplace/token", { method: "POST" })
        const t = await rt.json().catch(() => ({})) as { token?: string; url?: string; error?: string }
        if (!rt.ok || !t.token || !t.url) throw new Error(t.error ?? "não consegui liberar o envio de arquivo")
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          setProgresso({ i: i + 1, n: files.length, nome: f.name, pct: 0 })
          await subirArquivo(t.url, t.token, f, pct => setProgresso({ i: i + 1, n: files.length, nome: f.name, pct }))
          foram.push(f.name)
        }
      }
      setFeedback({ ok: true, msg: files.length ? `Enviado com ${files.length} arquivo${files.length > 1 ? "s" : ""}!` : "Enviado!" })
      setText("")
      setFiles([])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const ja = [textoFoi ? "a mensagem" : "", ...foram].filter(Boolean)
      setFeedback({ ok: false, msg: `${ja.length ? `Já foi: ${ja.join(", ")}. ` : ""}Falhou: ${msg}` })
      if (textoFoi) setText("")
      if (foram.length) setFiles(prev => prev.filter(f => !foram.includes(f.name)))
    } finally {
      setSending(false)
      setProgresso(null)
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
              ? `Tem arquivo com mais de 150 MB. Divide em partes ou compacta mais.`
              : `A mensagem vai primeiro e os arquivos logo depois, como documento. Até 150 MB por arquivo${files.length ? ` (agora ${fmtTam(total)} no total)` : ""}.`}
          </p>
        </div>

        {progresso && (
          <div className="space-y-1" data-testid="aviso-progresso">
            <p className="text-[11px] font-semibold text-[#0F1E3C]/60 truncate">
              Enviando {progresso.n > 1 ? `${progresso.i} de ${progresso.n}: ` : ""}{progresso.nome} · {progresso.pct < 100 ? `${progresso.pct}%` : "mandando pro WhatsApp…"}
            </p>
            <div className="h-1.5 rounded-full bg-[#0F1E3C]/8 overflow-hidden">
              <div className="h-full bg-[#4361EE] transition-all" style={{ width: `${progresso.pct}%` }} />
            </div>
          </div>
        )}

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
