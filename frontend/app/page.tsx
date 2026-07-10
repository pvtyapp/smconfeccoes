export const dynamic = "force-dynamic"

import Image from "next/image"
import Link from "next/link"
import { MessageCircle, MapPin, Package, Truck, Clock, ChevronRight } from "lucide-react"
import CatalogCarousel, { type CatalogProduct } from "@/components/landing/CatalogCarousel"
import WhatsAppButton from "@/components/landing/WhatsAppButton"
import LandingNavbar from "@/components/landing/LandingNavbar"
import HeroBannerCarousel, { type HeroBanner } from "@/components/landing/HeroBannerCarousel"
import { pool } from "@/lib/db"

const WA_LINK = `https://wa.me/5516992692363?text=${encodeURIComponent(
  "Olá! Gostaria de mais informações sobre a SM Confecções."
)}`

async function getCatalog(): Promise<CatalogProduct[]> {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id, p.name, p.image_url, p.display_order, p.description, p.cover_color,
        COALESCE(
          json_agg(
            json_build_object('id', i.id, 'image_url', i.image_url, 'display_order', i.display_order, 'color', i.color)
            ORDER BY i.display_order ASC, i.created_at ASC
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'
        ) AS images
      FROM catalog_products p
      LEFT JOIN catalog_product_images i ON i.product_id = p.id
      WHERE p.active = true
      GROUP BY p.id
      ORDER BY p.display_order ASC, p.created_at ASC
    `)
    return rows
  } catch {
    return []
  }
}

async function getHeroBanners(): Promise<HeroBanner[]> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hero_banners (
        id            SERIAL PRIMARY KEY,
        image_url     TEXT NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    const { rows } = await pool.query(`
      SELECT id, image_url FROM hero_banners ORDER BY display_order ASC, created_at ASC
    `)
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
    badge: "Sem pedido mínimo",
    desc: "Somos a fábrica. Qualidade em cada peça, preço de quem produz e atendimento rápido direto no WhatsApp.",
    cta: "Fazer pedido no WhatsApp",
    items: [
      "Preço de fábrica, sem intermediários",
      "Produção própria com qualidade",
      "Variedade de modelos, tamanhos e cores",
      "Produção sob encomenda disponível",
    ],
  },
  {
    icon: Truck,
    title: "Dropshipping",
    badge: "Sem estoque próprio",
    desc: "Venda nossas peças sem precisar comprar estoque. Você vende, nós produzimos e enviamos direto ao seu cliente.",
    cta: "Quero revender no WhatsApp",
    items: [
      "Zero investimento em estoque",
      "Nós cuidamos da produção e envio",
      "Margens atrativas para revendedores",
      "Atendimento direto pelo WhatsApp",
    ],
  },
]

export default async function LandingPage() {
  const catalog = await getCatalog()
  const heroBanners = await getHeroBanners()

  return (
    <div className="min-h-screen bg-white text-[#0F1E3C]" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>

      <LandingNavbar waLink={WA_LINK} />

      {heroBanners.length > 0 ? (
        <HeroBannerCarousel banners={heroBanners} />
      ) : (
      /* ── HERO ── */
      <section className="relative bg-[#0A1628] text-white overflow-hidden pt-[100px]">
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

              {/* Badge */}
              <div className="mt-8 flex items-center gap-2.5 bg-white/8 border border-white/15 backdrop-blur-sm px-4 py-2.5 rounded-full">
                <Package size={14} className="text-[#93A8F4]" />
                <span className="text-xs font-semibold text-white/80 tracking-wide">
                  Atacado sem pedido mínimo
                </span>
              </div>
            </div>

            {/* RIGHT — Title + CTAs */}
            <div className="flex-1 text-center lg:text-left">
              <p className="text-[#93A8F4] text-sm font-semibold uppercase tracking-[0.2em] mb-4">
                Confecção própria · Franca/SP
              </p>

              <h1
                className="text-[clamp(2.25rem,10vw,6rem)] font-black leading-[1.0] text-white mb-6"
                style={{ fontFamily: "var(--font-playfair)" }}
              >
                SM<br />
                <span className="text-[#4361EE]">Confecções</span>
              </h1>

              <p className="text-white/60 text-base lg:text-xl font-light mb-4 max-w-md mx-auto lg:mx-0">
                Atacado · Dropshipping
              </p>
              <p className="text-white/75 text-base lg:text-xl mb-10 max-w-md mx-auto lg:mx-0 leading-relaxed font-medium">
                Compre sem pedido mínimo, nosso atendimento é o mais rápido da região!
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
      )}

      {/* ── STRIP STATS ── */}
      <div className="bg-[#4361EE]">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between overflow-x-auto gap-6">
          {[
            { val: "Sem mínimo", label: "Compre quanto quiser" },
            { val: "100%", label: "Produção própria" },
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
              Em Breve
            </span>
            <h2
              className="text-2xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-4"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              Ponto de Coleta
            </h2>
            <p className="text-[#0F1E3C]/50 text-base sm:text-lg max-w-lg mx-auto leading-relaxed">
              Vendedor de Shopee ou TikTok Shop? Traga seus pedidos vendidos aqui.
              Nós cuidamos de todo o processo de postagem e envio pra você.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-xl mx-auto mb-8">
            {/* Shopee */}
            <div className="bg-white rounded-2xl p-7 sm:p-8 flex flex-col items-center gap-5 border border-gray-100 opacity-75">
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FF6130] to-[#F95B2B] flex items-center justify-center shadow-md shadow-[#F95B2B]/20">
                <span className="text-white text-2xl font-black">S</span>
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-[#4361EE] rounded-full flex items-center justify-center">
                  <Clock size={12} color="white" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-xl font-black text-[#0F1E3C]">Shopee</p>
                <p className="text-sm text-[#0F1E3C]/45 mt-1">Ponto de postagem para vendedores</p>
              </div>
              <span className="bg-[#4361EE]/10 text-[#4361EE] text-[11px] font-black uppercase tracking-wide px-3 py-1 rounded-full">
                Em Breve
              </span>
            </div>

            {/* TikTok */}
            <div className="bg-white rounded-2xl p-7 sm:p-8 flex flex-col items-center gap-5 border border-gray-100 opacity-75">
              <div className="relative w-16 h-16 rounded-2xl bg-[#010101] flex items-center justify-center shadow-md shadow-black/15">
                <span className="text-white text-2xl font-black">T</span>
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-[#4361EE] rounded-full flex items-center justify-center">
                  <Clock size={12} color="white" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-xl font-black text-[#0F1E3C]">TikTok Shop</p>
                <p className="text-sm text-[#0F1E3C]/45 mt-1">Ponto de postagem para vendedores</p>
              </div>
              <span className="bg-[#4361EE]/10 text-[#4361EE] text-[11px] font-black uppercase tracking-wide px-3 py-1 rounded-full">
                Em Breve
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 max-w-xl mx-auto">
            <div className="flex items-center gap-2.5 bg-white border border-[#0F1E3C]/8 rounded-xl px-5 py-3 shadow-sm">
              <span className="text-[#0F1E3C] text-sm font-semibold">Horário de Funcionamento</span>
              <span className="bg-[#4361EE]/10 text-[#4361EE] text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full">
                Em Breve
              </span>
            </div>
            <a
              href="#localizacao"
              className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-bold px-5 py-3 rounded-xl transition-colors"
            >
              <MapPin size={15} />
              Ver endereço
            </a>
          </div>
        </div>
      </section>

      {/* ── CATÁLOGO ── */}
      <CatalogCarousel initialProducts={catalog} waLink={WA_LINK} />

      {/* ── SERVIÇOS ── */}
      <section id="servicos" className="py-20 sm:py-28 px-5 bg-[#F4F6FB]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2
              className="text-2xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-4"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              Para lojistas e revendedores
            </h2>
            <p className="text-[#0F1E3C]/45 text-base sm:text-lg max-w-md mx-auto">
              Duas formas de trabalhar com a SM Confecções
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl mx-auto">
            {services.map((s, i) => (
              <div
                key={s.title}
                className={`rounded-2xl p-8 border transition-all hover:shadow-md ${
                  i === 0
                    ? "bg-[#0F1E3C] border-[#0F1E3C]"
                    : "bg-white border-[#0F1E3C]/8 hover:border-[#4361EE]/20"
                }`}
              >
                <div className="flex items-center gap-3 mb-5">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: i === 0 ? "rgba(255,255,255,0.1)" : "#4361EE15" }}
                  >
                    <s.icon size={20} color={i === 0 ? "#93A8F4" : "#4361EE"} />
                  </div>
                  <span
                    className="text-[11px] font-black uppercase tracking-wide px-3 py-1 rounded-full"
                    style={
                      i === 0
                        ? { backgroundColor: "rgba(255,255,255,0.12)", color: "#93A8F4" }
                        : { backgroundColor: "#4361EE15", color: "#4361EE" }
                    }
                  >
                    {s.badge}
                  </span>
                </div>

                <h3
                  className={`text-2xl font-black mb-3 ${i === 0 ? "text-white" : "text-[#0F1E3C]"}`}
                  style={{ fontFamily: "var(--font-playfair)" }}
                >
                  {s.title}
                </h3>
                <p className={`text-sm leading-relaxed mb-6 ${i === 0 ? "text-white/55" : "text-[#0F1E3C]/50"}`}>
                  {s.desc}
                </p>
                <ul className="space-y-3">
                  {s.items.map((item) => (
                    <li
                      key={item}
                      className={`flex items-center gap-2.5 text-sm ${i === 0 ? "text-white/70" : "text-[#0F1E3C]/65"}`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: i === 0 ? "#93A8F4" : "#4361EE" }}
                      />
                      {item}
                    </li>
                  ))}
                </ul>

                <a
                  href={WA_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`mt-7 flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-xl transition-colors ${
                    i === 0
                      ? "bg-white/10 hover:bg-white/15 text-white"
                      : "bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white"
                  }`}
                >
                  <MessageCircle size={15} />
                  {s.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LOCALIZAÇÃO ── */}
      <section id="localizacao" className="py-20 sm:py-28 px-5 bg-[#F4F6FB]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2
              className="text-2xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-4"
              style={{ fontFamily: "var(--font-playfair)" }}
            >
              Onde nos encontrar
            </h2>
            <p className="text-[#0F1E3C]/45 text-base sm:text-lg max-w-sm mx-auto mb-6">
              Visite a fábrica ou fale antes pelo WhatsApp
            </p>
            {/* Reference tags */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {[
                "Em frente ao Condomínio Franca Garden",
                "Ao lado da entrada do estacionamento do Tiaozinho Supermercado",
              ].map((ref) => (
                <span
                  key={ref}
                  className="inline-flex items-center gap-1.5 bg-white border border-[#0F1E3C]/10 text-[#0F1E3C]/65 text-xs font-semibold px-3.5 py-1.5 rounded-full shadow-sm"
                >
                  <MapPin size={11} className="text-[#4361EE]" />
                  {ref}
                </span>
              ))}
            </div>
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
            className="text-2xl sm:text-4xl md:text-5xl font-black mb-5 leading-tight"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Quer comprar no atacado?
          </h2>
          <p className="text-white/45 text-base sm:text-lg mb-10 leading-relaxed max-w-md mx-auto">
            Sem pedido mínimo. Fale agora no WhatsApp, te respondemos rápido.
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
          <p className="text-white/25 text-sm mt-6">(16) 99269-2363</p>
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
              (16) 99269-2363
            </a>
            <span className="text-white/15">·</span>
            <a
              href="https://www.instagram.com/smconfeccoes.franca/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-white/60 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
              </svg>
              @smconfeccoes.franca
            </a>
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
