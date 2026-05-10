type Props = {
  title: string
  value: string | number
  sub?: string
  color?: "default" | "red" | "green" | "yellow" | "blue"
}

const colorMap = {
  default: "border-gray-200",
  red: "border-red-300 bg-red-50",
  green: "border-green-300 bg-green-50",
  yellow: "border-yellow-300 bg-yellow-50",
  blue: "border-blue-300 bg-blue-50",
}

export default function MetricCard({ title, value, sub, color = "default" }: Props) {
  return (
    <div className={`rounded-xl border p-5 bg-white shadow-sm ${colorMap[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}
