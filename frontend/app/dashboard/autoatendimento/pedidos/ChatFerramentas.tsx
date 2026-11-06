"use client"

import { useEffect, useRef, useState } from "react"
import { Mic, Send, Trash2, X, Search } from "lucide-react"

// Ferramentas do WhatsApp no chat do Autoatendimento (PIV 05/11: "rápido, inteligente
// e leve"). Sem biblioteca de emoji nem de gravação: lista própria e o MediaRecorder
// do navegador, pra não pesar a tela.

export const REACOES_RAPIDAS = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "🥰", "😘", "😉", "😎", "🤩", "🥳",
  "🙂", "🤗", "🤔", "😅", "😬", "🙄", "😴", "😢", "😭", "😡", "😱", "🤯",
  "👍", "👎", "👌", "✌️", "🤞", "👏", "🙌", "🙏", "💪", "👋", "🤝", "👀",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💯", "🔥", "✨", "⭐",
  "✅", "❌", "⚠️", "❗", "❓", "⏰", "📦", "🚚", "📍", "💰", "💳", "🧾",
  "👕", "👚", "👖", "🧵", "🪡", "✂️", "🎨", "🖨️", "📸", "📎", "📄", "📅",
  "🎉", "🎁", "🙋", "🤷", "😇", "🫶", "😋", "🤑", "😌", "🥲", "😳", "🫡",
]

const CHAVE_RECENTES = "chat_emojis_recentes"

function lerRecentes(): string[] {
  try { return JSON.parse(localStorage.getItem(CHAVE_RECENTES) || "[]") } catch { return [] }
}

export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [recentes, setRecentes] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { setRecentes(lerRecentes()) }, [])
  useEffect(() => {
    const fora = (ev: MouseEvent) => { if (ref.current && !ref.current.contains(ev.target as Node)) onClose() }
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose() }
    document.addEventListener("mousedown", fora)
    document.addEventListener("keydown", esc)
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc) }
  }, [onClose])

  function escolhe(e: string) {
    const n = [e, ...recentes.filter(x => x !== e)].slice(0, 12)
    setRecentes(n)
    try { localStorage.setItem(CHAVE_RECENTES, JSON.stringify(n)) } catch { /* ignora */ }
    onPick(e)
  }

  const grade = (lista: string[]) => (
    <div className="grid grid-cols-8 gap-0.5">
      {lista.map(e => (
        <button key={e} type="button" onClick={() => escolhe(e)}
          className="w-9 h-9 rounded-lg text-[22px] leading-none flex items-center justify-center hover:bg-white/10 transition-colors">{e}</button>
      ))}
    </div>
  )

  return (
    <div ref={ref} className="wa-pop absolute bottom-full left-2 mb-2 w-[330px] max-h-[300px] overflow-y-auto rounded-xl p-2 shadow-2xl z-30"
      style={{ background: "#233138" }}>
      {recentes.length > 0 && <>
        <p className="text-[10px] font-bold uppercase tracking-wider px-1 pb-1" style={{ color: "#8696A0" }}>Recentes</p>
        {grade(recentes)}
        <p className="text-[10px] font-bold uppercase tracking-wider px-1 pt-2 pb-1" style={{ color: "#8696A0" }}>Todos</p>
      </>}
      {grade(EMOJIS)}
    </div>
  )
}

// Barra de reação rápida (igual ao WhatsApp: passa o mouse, escolhe o emoji)
export function BarraReacao({ atual, onPick, onClose, lado }: {
  atual: string | null; onPick: (e: string) => void; onClose: () => void; lado: "esq" | "dir"
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fora = (ev: MouseEvent) => { if (ref.current && !ref.current.contains(ev.target as Node)) onClose() }
    document.addEventListener("mousedown", fora)
    return () => document.removeEventListener("mousedown", fora)
  }, [onClose])
  return (
    <div ref={ref} className={`wa-pop absolute -top-11 ${lado === "dir" ? "right-0" : "left-0"} flex items-center gap-0.5 rounded-full px-1.5 py-1 shadow-xl z-20`}
      style={{ background: "#233138" }}>
      {REACOES_RAPIDAS.map(e => (
        <button key={e} type="button" onClick={() => onPick(atual === e ? "" : e)}
          className={`w-8 h-8 rounded-full text-[20px] leading-none flex items-center justify-center transition-transform hover:scale-125 ${atual === e ? "bg-white/15" : ""}`}>{e}</button>
      ))}
    </div>
  )
}

// Reações embaixo da bolha
export function ReacoesBolha({ reacoes, lado }: { reacoes: Record<string, string> | null | undefined; lado: "esq" | "dir" }) {
  const lista = Object.entries(reacoes ?? {}).filter(([, e]) => e)
  if (!lista.length) return null
  const emojis = [...new Set(lista.map(([, e]) => e))]
  const titulo = lista.map(([quem, e]) => `${quem === "eu" ? "Você" : "Cliente"}: ${e}`).join("  ")
  return (
    <div className={`absolute top-full -mt-1.5 ${lado === "dir" ? "right-3" : "left-3"} flex items-center gap-0.5 rounded-full px-1.5 py-[1px] shadow-md text-[15px] leading-6 z-[1]`}
      style={{ background: "#202C33", border: "1px solid #0B141A" }} title={titulo}>
      {emojis.join("")}
      {lista.length > 1 && <span className="text-[10px] ml-0.5" style={{ color: "#AEBAC1" }}>{lista.length}</span>}
    </div>
  )
}

// Encaminhar: escolhe a conversa de destino
export function EncaminharModal<C extends { id: number; name: string | null; phone: string; profilePic: string | null }>({
  conversas, onPick, onClose, enviando, fmt,
}: { conversas: C[]; onPick: (c: C) => void; onClose: () => void; enviando: boolean; fmt: (fone: string) => string }) {
  const [q, setQ] = useState("")
  const busca = q.trim().toLowerCase()
  const lista = busca
    ? conversas.filter(c => (c.name ?? "").toLowerCase().includes(busca) || c.phone.includes(busca.replace(/\D/g, "") || "§"))
    : conversas
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="wa-pop w-full max-w-[380px] max-h-[70vh] flex flex-col rounded-xl overflow-hidden shadow-2xl" style={{ background: "#111B21" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: "#202C33" }}>
          <button onClick={onClose} style={{ color: "#AEBAC1" }}><X size={18} /></button>
          <p className="text-[15px] font-medium" style={{ color: "#E9EDEF" }}>Encaminhar para</p>
        </div>
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "#202C33" }}>
            <Search size={14} style={{ color: "#8696A0" }} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Pesquisar nome ou número"
              className="flex-1 bg-transparent text-[13px] focus:outline-none" style={{ color: "#E9EDEF", border: "none", boxShadow: "none" }} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {lista.map(c => (
            <button key={c.id} disabled={enviando} onClick={() => onPick(c)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5 disabled:opacity-40 transition-colors">
              <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-[12px] font-bold text-white" style={{ background: "#2A3942" }}>
                {c.profilePic
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={c.profilePic} alt="" className="w-full h-full object-cover" />
                  : (c.name || c.phone).slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[14px] truncate" style={{ color: "#E9EDEF" }}>{c.name || fmt(c.phone)}</p>
                {c.name && <p className="text-[11px]" style={{ color: "#8696A0" }}>{fmt(c.phone)}</p>}
              </div>
            </button>
          ))}
          {!lista.length && <p className="text-center text-[12px] py-8" style={{ color: "#8696A0" }}>Nenhuma conversa encontrada</p>}
        </div>
      </div>
    </div>
  )
}

function fmtSeg(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// Microfone: clica, grava, manda como mensagem de voz. Lixeira cancela.
export function GravadorAudio({ onEnviar, onGravando }: {
  onEnviar: (arquivo: File) => Promise<void> | void
  onGravando: (gravando: boolean) => void
}) {
  const [gravando, setGravando] = useState(false)
  const [seg, setSeg] = useState(0)
  const [erro, setErro] = useState("")
  const rec = useRef<MediaRecorder | null>(null)
  const partes = useRef<Blob[]>([])
  const cancelado = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { rec.current?.stream.getTracks().forEach(t => t.stop()); if (timer.current) clearInterval(timer.current) }, [])

  async function comecar() {
    setErro("")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const tipo = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t)) ?? ""
      const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined)
      partes.current = []
      cancelado.current = false
      r.ondataavailable = e => { if (e.data.size) partes.current.push(e.data) }
      r.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        if (timer.current) clearInterval(timer.current)
        setGravando(false); onGravando(false)
        if (cancelado.current || !partes.current.length) return
        const mime = (r.mimeType || "audio/webm").split(";")[0]
        const blob = new Blob(partes.current, { type: mime })
        onEnviar(new File([blob], `audio.${mime.includes("ogg") ? "ogg" : "webm"}`, { type: mime }))
      }
      rec.current = r
      r.start()
      setSeg(0); setGravando(true); onGravando(true)
      timer.current = setInterval(() => setSeg(s => s + 1), 1000)
    } catch {
      setErro("Libere o microfone no navegador")
      setTimeout(() => setErro(""), 3000)
    }
  }

  function parar(cancelar: boolean) {
    cancelado.current = cancelar
    if (rec.current?.state === "recording") rec.current.stop()
  }

  if (!gravando) return (
    <div className="relative flex-shrink-0">
      {erro && <span className="wa-pop absolute bottom-full right-0 mb-2 whitespace-nowrap text-[11px] px-2 py-1 rounded-md" style={{ background: "#233138", color: "#F15C6D" }}>{erro}</span>}
      <button type="button" onClick={comecar} title="Gravar áudio"
        className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-white/10" style={{ color: "#8696A0" }}>
        <Mic size={22} />
      </button>
    </div>
  )

  return (
    <div className="flex-1 flex items-center justify-end gap-3 min-w-0">
      <button type="button" onClick={() => parar(true)} title="Cancelar"
        className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10" style={{ color: "#8696A0" }}>
        <Trash2 size={20} />
      </button>
      <span className="flex items-center gap-2 text-[15px] tabular-nums" style={{ color: "#E9EDEF" }}>
        <span className="wa-rec w-2.5 h-2.5 rounded-full" style={{ background: "#F15C6D" }} />
        {fmtSeg(seg)}
      </span>
      <button type="button" onClick={() => parar(false)} title="Enviar áudio"
        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#00A884" }}>
        <Send size={18} style={{ color: "#fff" }} />
      </button>
    </div>
  )
}

// Destaca o termo buscado dentro do texto da mensagem
export function Destaque({ texto, termo }: { texto: string; termo: string }) {
  const t = termo.trim()
  if (!t) return <>{texto}</>
  const partes = texto.split(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"))
  return <>{partes.map((p, i) => i % 2 ? <mark key={i} className="rounded px-0.5" style={{ background: "#FFD279", color: "#111B21" }}>{p}</mark> : p)}</>
}

// Formatação do WhatsApp: *negrito*, _itálico_, ~riscado~, ```mono``` e links
// clicáveis. Sem isso a assinatura do operador aparecia com os asteriscos.
const RE_WA = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[\s\S]+?```|https?:\/\/[^\s]+)/g

export function TextoWA({ texto, termo = "" }: { texto: string; termo?: string }) {
  const partes = texto.split(RE_WA)
  return <>{partes.map((p, i) => {
    if (i % 2 === 0) return <Destaque key={i} texto={p} termo={termo} />
    if (p.startsWith("```")) return <code key={i} className="font-mono text-[12px]">{p.slice(3, -3)}</code>
    if (p.startsWith("http")) return <a key={i} href={p} target="_blank" rel="noreferrer" className="underline break-all" style={{ color: "#027EB5" }}>{p}</a>
    const dentro = <Destaque texto={p.slice(1, -1)} termo={termo} />
    if (p[0] === "*") return <strong key={i} className="font-semibold">{dentro}</strong>
    if (p[0] === "_") return <em key={i}>{dentro}</em>
    return <s key={i}>{dentro}</s>
  })}</>
}
