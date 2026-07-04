"use client"

import { useRef, useState, useEffect } from "react"

interface AudioPlayerProps {
  src: string
  isOut: boolean
}

function fmt(s: number): string {
  if (!isFinite(s) || isNaN(s)) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

export default function AudioPlayer({ src, isOut }: AudioPlayerProps) {
  const audioRef              = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDur]    = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onMeta  = () => { setDur(el.duration ?? 0); setLoading(false) }
    const onTime  = () => setCurrent(el.currentTime)
    const onEnd   = () => { setPlaying(false); setCurrent(0) }
    const onWait  = () => setLoading(true)
    const onReady = () => setLoading(false)
    el.addEventListener("loadedmetadata", onMeta)
    el.addEventListener("timeupdate",     onTime)
    el.addEventListener("ended",          onEnd)
    el.addEventListener("waiting",        onWait)
    el.addEventListener("canplay",        onReady)
    return () => {
      el.removeEventListener("loadedmetadata", onMeta)
      el.removeEventListener("timeupdate",     onTime)
      el.removeEventListener("ended",          onEnd)
      el.removeEventListener("waiting",        onWait)
      el.removeEventListener("canplay",        onReady)
    }
  }, [src])

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else         { el.play().catch(() => {}); setPlaying(true) }
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value)
    if (audioRef.current) audioRef.current.currentTime = t
    setCurrent(t)
  }

  const progress = duration > 0 ? (current / duration) * 100 : 0
  const accent   = isOut ? "#128C7E" : "#25D366"
  const track    = isOut ? "#b2dfdb" : "#D1D7DB"
  const timeStr  = playing || current > 0 ? fmt(current) : fmt(duration)

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2 min-w-[200px] max-w-[240px]">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play / Pause button */}
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity active:opacity-70"
        style={{ background: accent }}
        aria-label={playing ? "Pausar" : "Reproduzir"}
      >
        {loading ? (
          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : playing ? (
          /* Pause icon */
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <rect x="5"  y="3" width="4" height="18" rx="1"/>
            <rect x="15" y="3" width="4" height="18" rx="1"/>
          </svg>
        ) : (
          /* Play icon */
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white" style={{ marginLeft: "1px" }}>
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      {/* Waveform / progress area */}
      <div className="flex-1 flex flex-col gap-1.5">
        {/* Fake waveform bars */}
        <div className="relative h-5 flex items-center">
          {/* Track background as bars */}
          <div className="absolute inset-0 flex items-center gap-[2px]">
            {Array.from({ length: 28 }).map((_, i) => {
              const heights = [3,4,6,5,8,6,4,9,7,5,8,6,4,7,5,8,6,4,9,7,5,6,4,8,6,5,4,3]
              const h = heights[i] ?? 5
              const filled = (i / 27) * 100 <= progress
              return (
                <div
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    height: `${h * 2}px`,
                    background: filled ? accent : track,
                    transition: "background 0.1s",
                  }}
                />
              )
            })}
          </div>
          {/* Invisible range input on top for seeking */}
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={current}
            onChange={seek}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
            aria-label="Posição do áudio"
          />
        </div>

        {/* Time */}
        <span className="text-[10px] font-medium tabular-nums" style={{ color: isOut ? "#548E87" : "#8696A0" }}>
          {timeStr}
        </span>
      </div>

      {/* Mic icon */}
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: isOut ? "#b2dfdb" : "#E9EDEF" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill={isOut ? "#128C7E" : "#8696A0"}>
          <path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2z"/>
        </svg>
      </div>
    </div>
  )
}
