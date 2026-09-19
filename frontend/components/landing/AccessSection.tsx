import { LogIn, UserPlus } from "lucide-react"
import LoginFormFields from "@/app/portal/components/LoginFormFields"
import CadastroFormFields from "@/app/portal/components/CadastroFormFields"

export default function AccessSection() {
  return (
    <section id="area-do-cliente" className="py-12 sm:py-16 px-5 bg-white">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8 sm:mb-10">
          <p className="text-[#4361EE] text-sm font-semibold uppercase tracking-[0.15em] mb-2">Área do Cliente</p>
          <h2
            className="text-2xl sm:text-4xl md:text-5xl font-black text-[#0F1E3C] mb-2"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            Monte seu pedido pelo site
          </h2>
          <p className="text-[#0F1E3C]/45 text-base sm:text-lg max-w-md mx-auto">
            Já é cliente? Entre. Primeira vez? Cria sua conta em menos de 1 minuto.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start max-w-3xl mx-auto">
          <div className="bg-[#F4F6FB] border border-[#0F1E3C]/8 rounded-2xl p-6 sm:p-8">
            <div className="w-11 h-11 rounded-xl bg-[#0F1E3C]/8 flex items-center justify-center mb-5">
              <LogIn size={19} className="text-[#0F1E3C]" />
            </div>
            <h3 className="text-lg font-black text-[#0F1E3C] mb-1">Já é cliente</h3>
            <p className="text-sm text-[#0F1E3C]/45 mb-6">Entre com seu WhatsApp e senha.</p>
            <LoginFormFields next="/portal" idPrefix="lp-login" />
          </div>

          <div className="bg-[#F4F6FB] border border-[#0F1E3C]/8 rounded-2xl p-6 sm:p-8">
            <div className="w-11 h-11 rounded-xl bg-[#4361EE]/10 flex items-center justify-center mb-5">
              <UserPlus size={19} className="text-[#4361EE]" />
            </div>
            <h3 className="text-lg font-black text-[#0F1E3C] mb-1">Criar conta</h3>
            <p className="text-sm text-[#0F1E3C]/45 mb-6">Confirmamos seu WhatsApp com um código — sem burocracia.</p>
            <CadastroFormFields next="/portal" idPrefix="lp-cad" />
          </div>
        </div>
      </div>
    </section>
  )
}
