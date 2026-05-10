type Color = "default" | "blue" | "green" | "yellow" | "red" | "purple"

const accent: Record<Color, string> = {
  default: "text-[#0F1E3C]",
  blue:    "text-[#4361EE]",
  green:   "text-emerald-600",
  yellow:  "text-amber-600",
  red:     "text-red-600",
  purple:  "text-purple-600",
}

const bg: Record<Color, string> = {
  default: "bg-white border-[#0F1E3C]/8",
  blue:    "bg-white border-[#4361EE]/20",
  green:   "bg-white border-emerald-200",
  yellow:  "bg-white border-amber-200",
  red:     "bg-white border-red-200",
  purple:  "bg-white border-purple-200",
}

type Props = {
  title: string
  value: string | number
  sub?: string
  color?: Color
}

export default function MetricCard({ title, value, sub, color = "default" }: Props) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${bg[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-[#0F1E3C]/40 mb-2">{title}</p>
      <p className={`text-2xl font-black ${accent[color]}`}>{value}</p>
      {sub && <p className="text-xs text-[#0F1E3C]/35 mt-1.5">{sub}</p>}
    </div>
  )
}
