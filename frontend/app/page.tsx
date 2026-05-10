import Link from "next/link"
import { Shirt, ShoppingBag, Package2, Scissors } from "lucide-react"

const products = [
  { icon: Shirt, label: "Camisetas" },
  { icon: ShoppingBag, label: "Moletons" },
  { icon: Package2, label: "Calças" },
  { icon: Scissors, label: "Peças sob demanda" },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-800">
      {/* Hero */}
      <section className="bg-gray-900 text-white py-24 px-6 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">SM Confecções</h1>
        <p className="text-lg text-gray-300 max-w-xl mx-auto mb-10">
          Confecção própria para atacado e varejo, com produção organizada, qualidade e pronta entrega.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <a href="#produtos" className="bg-white text-gray-900 font-semibold px-6 py-3 rounded-lg hover:bg-gray-100 transition-colors">
            Conhecer produtos
          </a>
          <Link href="/login" className="border border-gray-500 text-gray-300 font-medium px-6 py-3 rounded-lg hover:border-gray-300 hover:text-white transition-colors text-sm">
            Entrar no sistema
          </Link>
        </div>
      </section>

      {/* Sobre */}
      <section className="py-20 px-6 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl font-bold mb-4">Sobre nós</h2>
        <p className="text-gray-600 leading-relaxed">
          A SM Confecções atua na produção de peças para atacado e varejo, com foco em organização, controle de produção,
          qualidade e atendimento ágil. Trabalhamos com produção própria e entrega rápida para lojistas e clientes finais.
        </p>
      </section>

      {/* Linhas */}
      <section id="produtos" className="py-16 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-10">Linhas de produtos</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {products.map(({ icon: Icon, label }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-6 text-center shadow-sm hover:shadow-md transition-shadow">
                <Icon className="mx-auto mb-3 text-gray-700" size={32} />
                <p className="text-sm font-semibold text-gray-700">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Atacado e Varejo */}
      <section className="py-20 px-6 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-10">Atacado e varejo</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            { title: "Atacado", items: ["Venda em quantidade", "Preços especiais para lojistas", "Produção sob demanda"] },
            { title: "Varejo", items: ["Venda unitária", "Variedade de tamanhos e cores", "Controle de estoque próprio"] },
          ].map((block) => (
            <div key={block.title} className="bg-gray-50 rounded-xl p-6 border border-gray-200">
              <h3 className="font-bold text-lg mb-3">{block.title}</h3>
              <ul className="space-y-2">
                {block.items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-600 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Contato */}
      <section className="py-16 px-6 bg-gray-900 text-white text-center">
        <h2 className="text-2xl font-bold mb-6">Entre em contato</h2>
        <div className="flex flex-col md:flex-row gap-6 justify-center text-gray-300 text-sm">
          <div>
            <p className="font-semibold text-white mb-1">WhatsApp</p>
            <p>(00) 00000-0000</p>
          </div>
          <div>
            <p className="font-semibold text-white mb-1">Instagram</p>
            <p>@smconfeccoes</p>
          </div>
          <div>
            <p className="font-semibold text-white mb-1">Endereço</p>
            <p>A definir</p>
          </div>
        </div>
      </section>

      <footer className="py-5 text-center text-xs text-gray-400 bg-gray-950">
        SM Confecções — Todos os direitos reservados
      </footer>
    </div>
  )
}
