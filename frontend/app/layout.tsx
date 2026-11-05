import type { Metadata } from "next"
import { Playfair_Display, DM_Sans, Anton } from "next/font/google"
import "./globals.css"

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  display: "swap",
})

// Título do site novo (PIV 05/11): condensado e grosso, mesma linha dos banners.
const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
})

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "SM Confecções — Atacado, Varejo e Dropshipping",
  description:
    "Confecção própria para atacado, varejo e dropshipping. Ponto de coleta Shopee e TikTok Shop. Atendimento pelo WhatsApp.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${playfair.variable} ${dmSans.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
        {children}
      </body>
    </html>
  )
}
