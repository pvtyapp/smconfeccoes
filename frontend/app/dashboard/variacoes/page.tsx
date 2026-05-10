"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { storageGet, storageSet } from "@/lib/storage"
import { MOCK_VARIANTS, MOCK_PRODUCTS } from "@/lib/mock-data"
import type { ProductVariant, Product } from "@/lib/types"
import { Plus, Power } from "lucide-react"

function getVariants(): ProductVariant[] { return storageGet<ProductVariant[]>("variants") ?? MOCK_VARIANTS }
function getProducts(): Product[] { return storageGet<Product[]>("products") ?? MOCK_PRODUCTS }

export default function VariacoesPage() {
  const [variants, setVariants] = useState<ProductVariant[]>(getVariants)
  const products = getProducts()
  const [showForm, setShowForm] = useState(false)
  const [filterProduct, setFilterProduct] = useState("")
  const [filterColor, setFilterColor] = useState("")
  const [filterSize, setFilterSize] = useState("")
  const [form, setForm] = useState({ productId: "", color: "", size: "", sku: "", salePrice: "", averageCost: "", minStock: "", targetStock: "" })

  function saveVariants(list: ProductVariant[]) { setVariants(list); storageSet("variants", list) }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const product = products.find((p) => p.id === form.productId)
    const novo: ProductVariant = {
      id: `v${Date.now()}`,
      productId: form.productId,
      productName: product?.name ?? "",
      color: form.color,
      size: form.size,
      sku: form.sku,
      salePrice: Number(form.salePrice),
      averageCost: Number(form.averageCost),
      minStock: Number(form.minStock),
      targetStock: Number(form.targetStock),
      status: "active",
    }
    saveVariants([...variants, novo])
    setShowForm(false)
    setForm({ productId: "", color: "", size: "", sku: "", salePrice: "", averageCost: "", minStock: "", targetStock: "" })
  }

  function toggleStatus(id: string) {
    saveVariants(variants.map((v) => v.id === id ? { ...v, status: v.status === "active" ? "inactive" : "active" } : v))
  }

  const filtered = variants.filter((v) =>
    (!filterProduct || v.productId === filterProduct) &&
    (!filterColor || v.color.toLowerCase().includes(filterColor.toLowerCase())) &&
    (!filterSize || v.size.toLowerCase().includes(filterSize.toLowerCase()))
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Variações</h1>
          <p className="text-sm text-gray-500">Unidade real de venda e controle de estoque</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="flex items-center gap-2">
          <Plus size={16} /> Nova variação
        </Button>
      </div>

      <div className="flex gap-3">
        <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white" value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}>
          <option value="">Todos os produtos</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Input placeholder="Filtrar cor" value={filterColor} onChange={(e) => setFilterColor(e.target.value)} className="max-w-36" />
        <Input placeholder="Filtrar tamanho" value={filterSize} onChange={(e) => setFilterSize(e.target.value)} className="max-w-36" />
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Nova variação</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Produto pai</Label>
              <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required>
                <option value="">Selecione...</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><Label>Cor</Label><Input className="mt-1" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} required /></div>
            <div><Label>Tamanho</Label><Input className="mt-1" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} required /></div>
            <div><Label>SKU</Label><Input className="mt-1" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required /></div>
            <div><Label>Preço de venda (R$)</Label><Input className="mt-1" type="number" step="0.01" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} required /></div>
            <div><Label>Custo médio (R$)</Label><Input className="mt-1" type="number" step="0.01" value={form.averageCost} onChange={(e) => setForm({ ...form, averageCost: e.target.value })} required /></div>
            <div><Label>Estoque mínimo</Label><Input className="mt-1" type="number" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} required /></div>
            <div><Label>Estoque alvo</Label><Input className="mt-1" type="number" value={form.targetStock} onChange={(e) => setForm({ ...form, targetStock: e.target.value })} required /></div>
            <div className="col-span-2 flex gap-3">
              <Button type="submit">Criar</Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">Produto</th>
              <th className="text-left px-5 py-3">Cor / Tamanho</th>
              <th className="text-left px-5 py-3">SKU</th>
              <th className="text-left px-5 py-3">Preço</th>
              <th className="text-left px-5 py-3">Custo</th>
              <th className="text-left px-5 py-3">Est. min/alvo</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-medium text-gray-800">{v.productName}</td>
                <td className="px-5 py-3 text-gray-600">{v.color} / {v.size}</td>
                <td className="px-5 py-3 text-gray-500 font-mono text-xs">{v.sku}</td>
                <td className="px-5 py-3 text-gray-600">R$ {v.salePrice.toFixed(2)}</td>
                <td className="px-5 py-3 text-gray-600">R$ {v.averageCost.toFixed(2)}</td>
                <td className="px-5 py-3 text-gray-500">{v.minStock} / {v.targetStock}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {v.status === "active" ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <button onClick={() => toggleStatus(v.id)} className="text-gray-400 hover:text-yellow-600"><Power size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
