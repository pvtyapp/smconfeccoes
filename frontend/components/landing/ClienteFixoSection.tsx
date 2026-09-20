import { CheckCircle2, MessageCircle } from "lucide-react"

const WA_LINK = `https://wa.me/5516992692363?text=${encodeURIComponent(
  "Olá! Quero saber mais sobre o Fornecedor Fixo SM."
)}`

const ITEMS = [
  "Prioridade real de produção e entrega quando a demanda de dezembro passar da capacidade",
  "Nota fiscal automática em toda venda, sem precisar solicitar",
  "Condição comercial travada — preço e prazo combinados uma vez, valem o período todo",
  "Entra sozinho quem já compra — sem formulário, sem fila de aprovação",
]

export default function ClienteFixoSection() {
  return (
    <section className="py-14 sm:py-20 px-5 bg-[#0A1628] relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[320px] bg-[#8A6D1F]/20 blur-[130px] rounded-full pointer-events-none" />

      <div className="relative max-w-3xl mx-auto text-center">
        <p className="text-[#D9B24C] text-sm font-bold uppercase tracking-[0.15em] mb-3">
          Reconhecimento automático · quem já compra
        </p>
        <h2
          className="text-2xl sm:text-4xl md:text-5xl font-black text-white mb-4 leading-tight"
          style={{ fontFamily: "var(--font-playfair)" }}
        >
          Programa Fornecedor Fixo
        </h2>
        <p className="text-white/60 text-base sm:text-lg mb-9 max-w-xl mx-auto leading-snug">
          Não é desconto. É garantia de fornecimento pra quem revende e não pode ficar sem estoque no pico.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left max-w-xl mx-auto mb-9">
          {ITEMS.map((item) => (
            <div key={item} className="flex items-start gap-2.5 bg-white/5 border border-white/10 rounded-xl px-4 py-3.5">
              <CheckCircle2 size={16} className="text-[#D9B24C] flex-shrink-0 mt-0.5" />
              <p className="text-white/75 text-sm leading-snug">{item}</p>
            </div>
          ))}
        </div>

        <p className="text-white/35 text-xs mb-5">
          Comprou uma vez? Já é Fornecedor Fixo. Sem aviso, sem burocracia — é só a forma como a gente organiza a produção no fim de ano.
        </p>

        <a
          href={WA_LINK} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2.5 bg-[#25D366] hover:bg-[#1ebe5d] text-white font-bold text-sm px-6 py-3.5 rounded-xl transition-all hover:scale-[1.02] shadow-lg shadow-[#25D366]/15"
        >
          <MessageCircle size={17} /> Tirar dúvidas no WhatsApp
        </a>
      </div>
    </section>
  )
}
