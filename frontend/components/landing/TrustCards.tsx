import { FileText, MessageCircleHeart, ClipboardCheck, Factory } from "lucide-react"

const ITEMS = [
  { icon: FileText, title: "Nota fiscal em toda venda", desc: "Emitida sempre, sem precisar pedir." },
  { icon: MessageCircleHeart, title: "Atendimento rápido e direto", desc: "Resposta no WhatsApp, sem enrolação." },
  { icon: ClipboardCheck, title: "Controle do seu histórico", desc: "Todo pedido salvo, com recibo pra baixar." },
  { icon: Factory, title: "Produção própria", desc: "Qualidade consistente, direto da fábrica." },
]

export default function TrustCards() {
  return (
    <section className="pb-12 sm:pb-16 px-5 bg-[#F4F6FB]">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {ITEMS.map((item) => (
            <div key={item.title} className="bg-white border border-[#0F1E3C]/8 rounded-2xl p-4 sm:p-5">
              <div className="w-10 h-10 rounded-xl bg-[#4361EE]/10 flex items-center justify-center mb-3">
                <item.icon size={18} className="text-[#4361EE]" />
              </div>
              <p className="text-sm font-bold text-[#0F1E3C] mb-1 leading-snug">{item.title}</p>
              <p className="text-xs text-[#0F1E3C]/45 leading-snug">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
