import Image from "next/image"
import Link from "next/link"
import { MessageCircle, MapPin, Package, Truck, Store, ShieldCheck, ChevronRight } from "lucide-react"
import CatalogCarousel, { type CatalogProduct } from "@/components/landing/CatalogCarousel"
import WhatsAppButton from "@/components/landing/WhatsAppButton"
import LandingNavbar from "@/components/landing/LandingNavbar"
import { pool } from "@/lib/db"

const WA_LINK = `https://wa.me/5516999999999?text=${encodeURIComponent(
  "Olá! Gostaria de mais informações sobre a SM Confecções."
)}`

async function getCatalog(): Promise<CatalogProduct[]> {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, image_url, display_order FROM catalog_products WHERE active = true ORDER BY display_order ASC, created_at ASC"
    )
    return rows
  } catch {
    return []
  }
}

const MAPS_EMBED =
  "https://maps.google.com/maps?q=Avenida+Santa+Cruz+3088+Vila+Santa+Cruz+Franca+SP&output=embed&z=16&hl=pt-BR"

const services = [
  {
    icon: Package,
    title: "Atacado",
    desc: "Preços especiais para lojistas. Compra por quantidade com variedade de tamanhos e cores.",
    items: ["Pedido mínimo combinado", "Variedade de modelos", "Produção sob encomenda"],
    accent: "#4361EE",
  },
  {
    icon: Store,
    title: "Varejo",
    desc: "Venda unitária com peças prontas para entrega. Qualidade garantida em cada peça.",
    items: ["Sem pedido mínimo", "Peças prontas", "Retirada presencial"],
    accent: "#0F1E3C",
  },
  {
    icon: Truck,
    title: "Dropshipping",
    desc: "Você vende, nós enviamos direto ao seu cliente. Sem necessidade de estoque próprio.",
    items: ["Sem estoque próprio", "Logística por nossa conta", "Integração simplificada"],
    accent: "#4361EE",
  },
]

export default async function LandingPage() {
  const catalog = await getCatalog()

  return (
    <div className="min-h-screen bg-white text-[#0F1E3C]" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>

      <LandingNavbar waLink={WA_LINK} />

      {/* ── HERO ── */}
      <section className="relative bg-[#0A1628] text-white overflow-hidden pt-[68px]">
        {/* Grid texture */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        {/* Ambient glow */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#4361EE]/15 blur-[140px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-[#4361EE]/8 blur-[100px] rounded-full pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-5">
          {/* Desktop: 2-col split | Mobile: stacked */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:min-h-[82vh] py-16 lg:py-0 gap-12 lg:gap-20">

            {/* LEFT — Logo */}
            <div className="flex-shrink-0 flex flex-col items-center lg:items-start lg:w-[42%]">
              <div className="relative">
                <div className="absolute inset-0 bg-[#4361EE]/10 blur-[60px] rounded-full scale-150" />
                <Image
                  src="/smsemfundo.png"
                  alt="SM Confecções"
                  width={280}
                  height={140}
                  className="relative brightness-0 invert w-[180px] sm:w-[220px] lg:w-[280px] h-auto"
                  priority
                />
              </div>

              {/* Badge — ponto de coleta */}
              <div className="mt-8 flex items-center gap-2.5 bg-white/8 border border-white/15 backdrop-blur-sm px-4 py-2.5 rounded-full">
                <ShieldCheck size={15} className="text-[#93A8F4]" />
                <span className="text-xs font-semibold text-white/80 tracking-wide">
                  Ponto de Coleta · Shopee &amp; TikTok Shop
                </span>
              </div>
            </div>

            {/* RIGHT — Title + CTAs */}
            <div className="flex-1 text-center lg:text-left">
              <p className="text-[#93A8F4] text-sm font-semibold uppercase tracking-[0.2em] mb-4">
                Confecção própria
              </p>

              <h1
                className="text-[clamp(3rem,8vw,6rem)] font-black leading-[1.0] text-white mb-6"
                style={{ fontFamily: "var(--font-playfair)" }}
              >
                SM<br />
                <span className="text-[#4361EE]">Confecções</span>
              </h1>

              <p className="text-white/60 text-lg lg:text-xl font-light mb-3 max-w-md mx-auto lg:mx-0">
                Atacado · Varejo · Dropshipping
              </p>
              <p className="text-white/40 text-base mb-10 max-w-sm mx-auto lg:mx-0 leading-relaxed">
                Produção própria com qualidade e entrega ágil.
                Atendimento direto pelo WhatsApp.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <a
                  href={WA_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2.5 bg-[#25D366] hover:bg-[#1ebe5d] text-white font-bold text-base px-7 py-4 rounded-xl transition-all hover:scale-[1.02] shadow-lg shadow-[#25D366]/20"
                >
                  <MessageCircle size={19} />
                  Falar no WhatsApp
                </a>
                <a
                  href="#catalogo"
                  className="inline-flex items-center justify-center gap-2 border border-white/20 hover:border-white/40 text-white/75 hover:text-white font-semibold text-base px-7 py-4 rounded-xl transition-all"
                >
                  Ver catálogo
                  <ChevronRight size={16} />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#0A1628] to-transparent" />
      </section>

      {/* ── STRIP STATS ── */}
      <div className="bg-[#4361EE]">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between overflow-x-auto gap-6">
          {[
            { val: "100%", label: "Produção própria" },
            { val: "Shopee + TikTok", label: "Pontos de coleta" },
            { val: "Atacado & Drop", label: "Para lojistas" },
            { val: "WhatsApp", label: "Atendimento direto" },
          ].map((s) => (
            <div key={s.label} className="text-center text-white flex-shrink-0">
              <p className="text-sm sm:text-base font-black">{s.val}</p>
              <p className="text-white/65 text-[11px] sm:text-xs mt-0.5 whitespace-nowrap">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── PONTOS DE COLETA ── */}
      <section id="coleta" className="py-20 sm:py-28 px-5 bg-[#F4F6FB]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <span className="inline-block bg-[#4361EE]/10 text-[#4361EE] text-[11px] font-black uppercase tracking-[0.18em] px-4 py-1.5 rounded-full mb-5">
              Novidade
            </span>
            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-4"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              Ponto de Coleta Oficial
            </h2>
            <p className="text-[#0F1E3C]/50 text-base sm:text-lg max-w-md mx-auto leading-relaxed">
              Comprou online? Retire sua encomenda diretamente aqui com segurança e sem complicação.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-xl mx-auto mb-6">
            {/* Shopee */}
            <div className="bg-white rounded-2xl p-7 sm:p-8 flex flex-col items-center gap-5 border border-[#F95B2B]/15 hover:border-[#F95B2B]/30 hover:shadow-lg transition-all group">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FF6130] to-[#F95B2B] flex items-center justify-center shadow-md shadow-[#F95B2B]/25 group-hover:scale-105 transition-transform">
                <span className="text-white text-2xl font-black">S</span>
              </div>
              <div className="text-center">
                <p className="text-xl font-black text-[#0F1E3C]">Shopee</p>
                <p className="text-sm text-[#0F1E3C]/45 mt-1">Ponto de coleta credenciado</p>
              </div>
              <span className="bg-[#FFF0EB] text-[#F95B2B] text-[11px] font-black uppercase tracking-wide px-3 py-1 rounded-full">
                Disponível agora
              </span>
            </div>

            {/* TikTok */}
            <div className="bg-white rounded-2xl p-7 sm:p-8 flex flex-col items-center gap-5 border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all group">
              <div className="w-16 h-16 rounded-2xl bg-[#010101] flex items-center justify-center shadow-md shadow-black/20 group-hover:scale-105 transition-transform">
                <span className="text-white text-2xl font-black">T</span>
              </div>
              <div className="text-center">
                <p className="text-xl font-black text-[#0F1E3C]">TikTok Shop</p>
                <p className="text-sm text-[#0F1E3C]/45 mt-1">Ponto de coleta credenciado</p>
              </div>
              <span className="bg-gray-100 text-gray-600 text-[11px] font-black uppercase tracking-wide px-3 py-1 rounded-full">
                Disponível agora
              </span>
            </div>
          </div>

          <p className="text-center text-sm text-[#4361EE] font-semibold">
            + Em breve: mais plataformas disponíveis
          </p>
        </div>
      </section>

      {/* ── SERVIÇOS ── */}
      <section id="servicos" className="py-20 sm:py-28 px-5 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-4"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              Como atendemos você
            </h2>
            <p className="text-[#0F1E3C]/45 text-base sm:text-lg max-w-md mx-auto">
              Soluções para lojistas, revendedores e clientes finais
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {services.map((s, i) => (
              <div
                key={s.title}
                className={`rounded-2xl p-7 border transition-all hover:shadow-md group ${
                  i === 1
                    ? "bg-[#0F1E3C] border-[#0F1E3C] text-white"
                    : "bg-white border-[#0F1E3C]/8 hover:border-[#4361EE]/25"
                }`}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                  style={{ backgroundColor: i === 1 ? "rgba(255,255,255,0.1)" : `${s.accent}15` }}
                >
                  <s.icon size={20} color={i === 1 ? "#fff" : s.accent} />
                </div>
                <h3
                  className={`text-xl font-black mb-2 ${i === 1 ? "text-white" : "text-[#0F1E3C]"}`}
                  style={{ fontFamily: "var(--font-playfair)" }}
                >
                  {s.title}
                </h3>
                <p className={`text-sm leading-relaxed mb-5 ${i === 1 ? "text-white/55" : "text-[#0F1E3C]/50"}`}>
                  {s.desc}
                </p>
                <ul className="space-y-2.5">
                  {s.items.map((item) => (
                    <li key={item} className={`flex items-center gap-2.5 text-sm ${i === 1 ? "text-white/70" : "text-[#0F1E3C]/65"}`}>
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: i === 1 ? "#93A8F4" : s.accent }}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CATÁLOGO ── */}
      <CatalogCarousel initialProducts={catalog} waLink={WA_LINK} />

      {/* ── LOCALIZAÇÃO ── */}
      <section id="localizacao" className="py-20 sm:py-28 px-5 bg-[#F4F6FB]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-4"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              Localização
            </h2>
            <p className="text-[#0F1E3C]/45 text-base sm:text-lg max-w-sm mx-auto">
              Retire sua encomenda ou visite nossa loja
            </p>
          </div>

          <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#0F1E3C]/6">
            <div className="w-full h-64 sm:h-80">
              <iframe
                src={MAPS_EMBED}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="SM Confecções — Localização"
              />
            </div>

            <div className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[#4361EE]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MapPin size={17} color="#4361EE" />
                </div>
                <div>
                  <p className="font-bold text-[#0F1E3C] text-sm">SM Confecções</p>
                  <p className="text-sm text-[#0F1E3C]/50 mt-0.5">Av. Santa Cruz, 3088 — Vila Santa Cruz, Franca/SP</p>
                  <p className="text-xs text-[#0F1E3C]/40 mt-1">Seg–Sex: 8h às 18h · Sáb: 8h às 13h</p>
                </div>
              </div>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=Avenida+Santa+Cruz+3088+Vila+Santa+Cruz+Franca+SP`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-[#25D366] text-white text-sm font-bold px-5 py-2.5 rounded-xl hover:bg-[#1ebe5d] transition-colors whitespace-nowrap"
              >
                <MessageCircle size={15} />
                Como chegar
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section className="py-24 px-5 bg-[#0A1628] text-white relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-[#4361EE]/15 blur-[120px] rounded-full pointer-events-none" />
        <div className="relative max-w-2xl mx-auto text-center">
          <h2
            className="text-3xl sm:text-4xl md:text-5xl font-black mb-5 leading-tight"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Pronto para fazer seu pedido?
          </h2>
          <p className="text-white/45 text-base sm:text-lg mb-10 leading-relaxed max-w-md mx-auto">
            Atendemos atacadistas, revendedores e clientes finais. Resposta rápida garantida.
          </p>
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 bg-[#25D366] hover:bg-[#1ebe5d] text-white font-black text-lg sm:text-xl px-9 py-5 rounded-2xl shadow-2xl shadow-black/30 transition-all hover:scale-[1.02]"
          >
            <MessageCircle size={23} />
            Falar no WhatsApp agora
          </a>
          <p className="text-white/25 text-sm mt-6">(16) 99999-9999</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-[#050C19] text-white/30 py-8 px-5">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-5 text-sm">
          <div className="flex items-center gap-3">
            <Image
              src="/smsemfundo.png"
              alt="SM Confecções"
              width={32}
              height={16}
              className="brightness-0 invert opacity-40"
            />
            <span>SM Confecções © 2025</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs">
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white/60 transition-colors"
            >
              (16) 99999-9999
            </a>
            <span className="text-white/15">·</span>
            <span>@smconfeccoes</span>
            <span className="text-white/15">·</span>
            <Link href="/login" className="hover:text-white/60 transition-colors">
              Área administrativa
            </Link>
          </div>
        </div>
      </footer>

      <WhatsAppButton href={WA_LINK} />
    </div>
  )
}
