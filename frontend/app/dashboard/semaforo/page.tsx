"use client"

import { useEffect, useState, useCallback } from "react"

type Status = "verde" | "amarelo" | "vermelho"

interface SemaforoData {
  corte: {
    status: Status
    label: string
    count: number
    ordens: { number: string; productName: string; totalPecas: number; semMaterial: boolean; diasAberto: number }[]
  }
  costura: {
    status: Status
    label: string
    totalAprovadas: number
    totalAvarias: number
    pctDefect: number
    stalledCount: number
  }
  estoque: {
    status: Status
    label: string
    abaixoMin: number
    zerados: number
  }
  updatedAt: string
}

const STATUS_COLOR: Record<Status, { glow: string; ring: string; bg: string; text: string; dot: string }> = {
  verde:    { glow: "#22c55e", ring: "#16a34a", bg: "#14532d", text: "#4ade80", dot: "bg-green-400"  },
  amarelo:  { glow: "#eab308", ring: "#ca8a04", bg: "#713f12", text: "#fde047", dot: "bg-yellow-400" },
  vermelho: { glow: "#ef4444", ring: "#dc2626", bg: "#7f1d1d", text: "#f87171", dot: "bg-red-400"    },
}

const STATUS_LABEL: Record<Status, string> = {
  verde:    "OPERACIONAL",
  amarelo:  "ATENÇÃO",
  vermelho: "CRÍTICO",
}

const BLOCK_FACES = {
  front: { transform: "rotateY(0deg)   translateZ(70px)" },
  back:  { transform: "rotateY(180deg) translateZ(70px)" },
  left:  { transform: "rotateY(-90deg) translateZ(70px)" },
  right: { transform: "rotateY(90deg)  translateZ(70px)" },
  top:   { transform: "rotateX(90deg)  translateZ(70px)" },
  bot:   { transform: "rotateX(-90deg) translateZ(70px)" },
}

const GRID_BG = `repeating-linear-gradient(0deg,rgba(0,0,0,.25) 0,rgba(0,0,0,.25) 1px,transparent 1px,transparent 17.5px),
  repeating-linear-gradient(90deg,rgba(0,0,0,.25) 0,rgba(0,0,0,.25) 1px,transparent 1px,transparent 17.5px)`

function MinecraftBlock({ status, label, sector, detail }: {
  status: Status
  label: string
  sector: string
  detail: React.ReactNode
}) {
  const c = STATUS_COLOR[status]
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      if (status === "vermelho") setPulse(p => !p)
    }, 600)
    return () => clearInterval(id)
  }, [status])

  const frontBg  = c.bg
  const topTint  = `color-mix(in srgb, ${c.bg} 60%, white)`
  const rightTint = `color-mix(in srgb, ${c.bg} 80%, black)`

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Semaphore light */}
      <div
        className="relative w-8 h-8 rounded-full transition-all duration-300"
        style={{
          background: c.glow,
          boxShadow: pulse || status !== "vermelho"
            ? `0 0 20px 6px ${c.glow}, 0 0 40px 12px ${c.glow}55`
            : "none",
          opacity: pulse && status === "vermelho" ? 0.4 : 1,
        }}
      />

      {/* 3-D block */}
      <div style={{ perspective: "600px" }}>
        <div
          style={{
            width: 140,
            height: 140,
            position: "relative",
            transformStyle: "preserve-3d",
            transform: "rotateX(25deg) rotateY(-40deg)",
          }}
        >
          {/* front */}
          <div style={{
            ...BLOCK_FACES.front,
            position: "absolute", width: 140, height: 140,
            background: frontBg, backgroundImage: GRID_BG,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `2px solid ${c.ring}`,
          }}>
            <span style={{ color: c.text, fontSize: 36, fontWeight: 900, fontFamily: "monospace", textShadow: `0 0 8px ${c.glow}` }}>
              {status === "verde" ? "✓" : status === "amarelo" ? "!" : "✗"}
            </span>
          </div>
          {/* top */}
          <div style={{
            ...BLOCK_FACES.top,
            position: "absolute", width: 140, height: 140,
            background: topTint, backgroundImage: GRID_BG,
            border: `2px solid ${c.ring}`,
          }} />
          {/* right */}
          <div style={{
            ...BLOCK_FACES.right,
            position: "absolute", width: 140, height: 140,
            background: rightTint, backgroundImage: GRID_BG,
            border: `2px solid ${c.ring}`,
          }} />
          {/* left */}
          <div style={{
            ...BLOCK_FACES.left,
            position: "absolute", width: 140, height: 140,
            background: `color-mix(in srgb, ${c.bg} 70%, black)`, backgroundImage: GRID_BG,
            border: `2px solid ${c.ring}`,
          }} />
          {/* bot */}
          <div style={{
            ...BLOCK_FACES.bot,
            position: "absolute", width: 140, height: 140,
            background: `color-mix(in srgb, ${c.bg} 50%, black)`, backgroundImage: GRID_BG,
            border: `2px solid ${c.ring}`,
          }} />
        </div>
      </div>

      {/* Sector label */}
      <div className="text-center">
        <p className="text-xs font-bold tracking-[0.3em] text-slate-400 uppercase mb-1">{sector}</p>
        <p className="text-sm font-bold tracking-widest uppercase" style={{ color: c.text }}>
          {STATUS_LABEL[status]}
        </p>
      </div>

      {/* Detail card */}
      <div
        className="w-64 rounded-lg p-3 text-xs space-y-1"
        style={{ background: "#0d1117", border: `1px solid ${c.ring}33` }}
      >
        <p className="text-slate-300 leading-relaxed">{label}</p>
        <div className="pt-1 border-t border-slate-800 text-slate-500 space-y-0.5">{detail}</div>
      </div>
    </div>
  )
}

export default function SemaforoPage() {
  const [data, setData] = useState<SemaforoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<string>("")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/producao/semaforo")
      if (!res.ok) return
      const json: SemaforoData = await res.json()
      setData(json)
      setLastUpdate(new Date(json.updatedAt).toLocaleTimeString("pt-BR"))
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#0a0f1e", color: "#e2e8f0", fontFamily: "monospace" }}
    >
      {/* Header */}
      <div className="text-center pt-10 pb-6 px-4">
        <p className="text-xs tracking-[0.5em] text-slate-500 uppercase mb-2">SM Confecções</p>
        <h1 className="text-2xl font-black tracking-[0.25em] uppercase text-slate-100">
          Semáforo de Produção
        </h1>
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-600">
          <span className={`w-1.5 h-1.5 rounded-full ${loading ? "bg-yellow-500 animate-pulse" : "bg-green-500"}`} />
          {loading ? "Carregando..." : `Atualizado às ${lastUpdate} · refresh 30s`}
        </div>
      </div>

      {/* Blocks */}
      {data ? (
        <div className="flex flex-col lg:flex-row items-start justify-center gap-12 px-6 pb-16 pt-4">

          {/* CORTE */}
          <MinecraftBlock
            status={data.corte.status}
            sector="Corte"
            label={data.corte.label}
            detail={
              <>
                {data.corte.ordens.length === 0 ? (
                  <p>Nenhuma ordem em andamento</p>
                ) : (
                  data.corte.ordens.slice(0, 5).map(o => (
                    <div key={o.number} className="flex justify-between gap-2">
                      <span className="text-slate-400 truncate max-w-[140px]">#{o.number} {o.productName}</span>
                      <span className={o.diasAberto > 7 ? "text-red-400" : "text-slate-500"}>
                        {o.diasAberto}d {o.semMaterial ? "⚠ sem mat." : `${o.totalPecas}pç`}
                      </span>
                    </div>
                  ))
                )}
                {data.corte.ordens.length > 5 && (
                  <p className="text-slate-600">+{data.corte.ordens.length - 5} ordem(ns)…</p>
                )}
              </>
            }
          />

          {/* COSTURA */}
          <MinecraftBlock
            status={data.costura.status}
            sector="Costura"
            label={data.costura.label}
            detail={
              <>
                <div className="flex justify-between">
                  <span>Aprovadas</span>
                  <span className="text-green-400">{data.costura.totalAprovadas}</span>
                </div>
                <div className="flex justify-between">
                  <span>Avarias</span>
                  <span className={data.costura.pctDefect > 15 ? "text-red-400" : data.costura.pctDefect > 5 ? "text-yellow-400" : "text-slate-400"}>
                    {data.costura.totalAvarias} ({data.costura.pctDefect}%)
                  </span>
                </div>
                {data.costura.stalledCount > 0 && (
                  <div className="flex justify-between text-red-400">
                    <span>Presas &gt;7d</span>
                    <span>{data.costura.stalledCount} ordem(ns)</span>
                  </div>
                )}
              </>
            }
          />

          {/* ESTOQUE */}
          <MinecraftBlock
            status={data.estoque.status}
            sector="Estoque"
            label={data.estoque.label}
            detail={
              <>
                <div className="flex justify-between">
                  <span>Abaixo do mínimo</span>
                  <span className={data.estoque.abaixoMin >= 4 ? "text-red-400" : data.estoque.abaixoMin > 0 ? "text-yellow-400" : "text-green-400"}>
                    {data.estoque.abaixoMin}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Zeradas</span>
                  <span className={data.estoque.zerados > 0 ? "text-red-400" : "text-slate-400"}>
                    {data.estoque.zerados}
                  </span>
                </div>
              </>
            }
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-slate-600 text-sm animate-pulse">Carregando semáforo...</div>
        </div>
      )}

      {/* Legend */}
      <div className="text-center pb-8 flex items-center justify-center gap-8 text-xs text-slate-600">
        {(["verde", "amarelo", "vermelho"] as Status[]).map(s => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[s].dot}`} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  )
}
