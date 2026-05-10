"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { storageGet, storageSet } from "@/lib/storage"
import { MOCK_PRODUCTS } from "@/lib/mock-data"
import type { Product } from "@/lib/types"
import { Plus, Pencil, Power } from "lucide-react"

function getProducts(): Product[] {
  return storageGet<Product[]>("products") ?? MOCK_PRODUCTS
}

export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>(getProducts)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState({ name: "", category: "", description: "", defaultSalePrice: "", averageCost: "" })

  function saveProducts(list: Product[]) {
    setProducts(list)
    storageSet("products", list)
  }

  function openNew() {
    setEditing(null)
    setForm({ name: "", category: "", description: "", defaultSalePrice: "", averageCost: "" })
    setShowForm(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setForm({ name: p.name, category: p.category, description: p.description ?? "", defaultSalePrice: String(p.defaultSalePrice), averageCost: String(p.averageCost) })
    setShowForm(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editing) {
      saveProducts(products.map((p) => p.id === editing.id ? { ...p, ...form, defaultSalePrice: Number(form.defaultSalePrice), averageCost: Number(form.averageCost) } : p))
    } else {
      const novo: Product = {
        id: `p${Date.now()}`,
        name: form.name,
        category: form.category,
        description: form.description,
        defaultSalePrice: Number(form.defaultSalePrice),
        averageCost: Number(form.averageCost),
        status: "active",
        createdAt: new Date().toISOString().split("T")[0],
      }
      saveProducts([...products, novo])
    }
    setShowForm(false)
  }

  function toggleStatus(id: string) {
    saveProducts(products.map((p) => p.id === id ? { ...p, status: p.status === "active" ? "inactive" : "active" } : p))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Produtos</h1>
          <p className="text-sm text-gray-500">Produtos pai — agrupam variações</p>
        </div>
        <Button onClick={openNew} className="flex items-center gap-2">
          <Plus size={16} /> Novo produto
        </Button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{editing ? "Editar produto" : "Novo produto"}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div>
              <Label>Nome</Label>
              <Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <Label>Categoria</Label>
              <Input className="mt-1" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required />
            </div>
            <div className="col-span-2">
              <Label>Descrição</Label>
              <Input className="mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <Label>Preço de venda padrão (R$)</Label>
              <Input className="mt-1" type="number" step="0.01" value={form.defaultSalePrice} onChange={(e) => setForm({ ...form, defaultSalePrice: e.target.value })} required />
            </div>
            <div>
              <Label>Custo médio (R$)</Label>
              <Input className="mt-1" type="number" step="0.01" value={form.averageCost} onChange={(e) => setForm({ ...form, averageCost: e.target.value })} required />
            </div>
            <div className="col-span-2 flex gap-3">
              <Button type="submit">{editing ? "Salvar" : "Criar"}</Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">Nome</th>
              <th className="text-left px-5 py-3">Categoria</th>
              <th className="text-left px-5 py-3">Preço venda</th>
              <th className="text-left px-5 py-3">Custo médio</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-medium text-gray-800">{p.name}</td>
                <td className="px-5 py-3 text-gray-600">{p.category}</td>
                <td className="px-5 py-3 text-gray-600">R$ {p.defaultSalePrice.toFixed(2)}</td>
                <td className="px-5 py-3 text-gray-600">R$ {p.averageCost.toFixed(2)}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {p.status === "active" ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-5 py-3 flex gap-2 justify-end">
                  <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-blue-600"><Pencil size={15} /></button>
                  <button onClick={() => toggleStatus(p.id)} className="text-gray-400 hover:text-yellow-600"><Power size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
