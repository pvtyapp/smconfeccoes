const MOCK_USERS = [
  { name: "Administrador", email: "dev@smconfeccoes.app", role: "admin", status: "ativo" },
]

const roleLabel: Record<string, string> = { admin: "Admin", estoque: "Estoque", pdv: "PDV" }
const roleColor: Record<string, string> = { admin: "bg-blue-100 text-blue-700", estoque: "bg-green-100 text-green-700", pdv: "bg-orange-100 text-orange-700" }

export default function UsuariosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Usuários</h1>
        <p className="text-sm text-gray-500">Gestão de acesso — em desenvolvimento</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm text-gray-600">
        {[
          { role: "Admin", desc: "Acesso total: produtos, custos, estoque, relatórios, usuários" },
          { role: "Estoque", desc: "Lançamento de entrada/saída, consulta de produtos e variações" },
          { role: "PDV", desc: "Vendas futuras, consulta de estoque — sem acesso a custos" },
        ].map((p) => (
          <div key={p.role} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="font-semibold text-gray-800 mb-1">{p.role}</p>
            <p className="text-gray-500">{p.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">Nome</th>
              <th className="text-left px-5 py-3">Email</th>
              <th className="text-left px-5 py-3">Perfil</th>
              <th className="text-left px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {MOCK_USERS.map((u) => (
              <tr key={u.email} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-medium text-gray-800">{u.name}</td>
                <td className="px-5 py-3 text-gray-600">{u.email}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColor[u.role]}`}>{roleLabel[u.role]}</span>
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">{u.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
