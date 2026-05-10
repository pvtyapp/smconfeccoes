const USERS = [
  { name: "Administrador", email: "dev@smconfeccoes.app", role: "Admin", status: "Ativo" },
]

const PERMISSIONS: Record<string, string[]> = {
  Admin:   ["Produtos", "Variações", "Estoque", "Custos", "Metas", "Relatórios", "Usuários", "Catálogo LP"],
  Estoque: ["Produtos (leitura)", "Variações (leitura)", "Estoque", "Custo de Produção"],
  PDV:     ["Consulta de estoque", "Vendas (em breve)"],
}

export default function UsuariosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Usuários</h1>
        <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Gerenciamento de acesso — CRUD completo disponível em breve</p>
      </div>

      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#0F1E3C]/5">
              {["Nome", "Email", "Perfil", "Status"].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0F1E3C]/4">
            {USERS.map((u) => (
              <tr key={u.email} className="hover:bg-[#F4F6FB] transition-colors">
                <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{u.name}</td>
                <td className="px-5 py-3 text-[#0F1E3C]/60">{u.email}</td>
                <td className="px-5 py-3">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-[#4361EE]/10 text-[#4361EE]">{u.role}</span>
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-emerald-100 text-emerald-700">{u.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {Object.entries(PERMISSIONS).map(([role, perms]) => (
          <div key={role} className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
            <h3 className="text-sm font-bold text-[#0F1E3C] mb-3">Perfil: {role}</h3>
            <ul className="space-y-1.5">
              {perms.map((p) => (
                <li key={p} className="flex items-center gap-2 text-xs text-[#0F1E3C]/65">
                  <span className="w-1.5 h-1.5 bg-[#4361EE] rounded-full flex-shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
