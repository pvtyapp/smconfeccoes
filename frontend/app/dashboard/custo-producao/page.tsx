"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { storageGet, storageSet } from "@/lib/storage"
import { MOCK_PRODUCTS, MOCK_VARIANTS } from "@/lib/mock-data"
import type { ProductionOrder, Product, ProductVariant } from "@/lib/types"
import { calcProductionCost, formatCurrency } from "@/lib/calculations"

function getOrders(): ProductionOrder[] { return storageGet<ProductionOrder[]>("productions") ?? [] }
function getProducts(): Product[] { return storageGet<Product[]>("products") ?? MOCK_PRODUCTS }
function getVariants(): ProductVariant[] { return storageGet<ProductVariant[]>("variants") ?? MOCK_VARIANTS }

type FormItem = { variantId: string; quantity: string }

export default function CustoProducaoPage() {
  const [orders, setOrders] = useState<ProductionOrder[]>(getOrders)
  const products = getProducts()
  const variants = getVariants()

  const [selectedProduct, setSelectedProduct] = useState("")
  const [items, setItems] = useState<FormItem[]>([{ variantId: "", quantity: "" }])
  const [fabric, setFabric] = useState({ kg: "", costPerKg: "" })
  const [sewing, setSewing] = useState("")
  const [thread, setThread] = useState("")
  const [packaging, setPackaging] = useState("")
  const [other, setOther] = useState("")
  const [notes, setNotes] = useState("")

  const productVariants = variants.filter((v) => v.productId === selectedProduct)
  const salePrice = products.find((p) => p.id === selectedProduct)?.defaultSalePrice ?? 0

  const totalQty = items.reduce((a, i) => a + (Number(i.quantity) || 0), 0)
  const calc = calcProductionCost({
    fabricKg: Number(fabric.kg) || 0,
    fabricCostPerKg: Number(fabric.costPerKg) || 0,
    sewingCostPerPiece: Number(sewing) || 0,
    threadCost: Number(thread) || 0,
    packagingCost: Number(packaging) || 0,
    otherCosts: Number(other) || 0,
    totalQuantity: totalQty,
    salePrice,
  })

  function addItem() { setItems([...items, { variantId: "", quantity: "" }]) }
  function updateItem(idx: number, field: keyof FormItem, val: string) {
    setItems(items.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  }
  function removeItem(idx: number) { setItems(items.filter((_, i) => i !== idx)) }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const order: ProductionOrder = {
      id: `po${Date.now()}`,
      productId: selectedProduct,
      items: items.map((i) => ({ variantId: i.variantId, quantity: Number(i.quantity) })),
      fabricKg: Number(fabric.kg),
      fabricCostPerKg: Number(fabric.costPerKg),
      sewingCostPerPiece: Number(sewing),
      threadCost: Number(thread),
      packagingCost: Number(packaging),
      otherCosts: Number(other),
      totalQuantity: totalQty,
      totalCost: calc.totalCost,
      unitCost: calc.unitCost,
      notes,
      createdAt: new Date().toISOString().split("T")[0],
    }
    const updated = [...orders, order]
    setOrders(updated)
    storageSet("productions", updated)
    setSelectedProduct(""); setItems([{ variantId: "", quantity: "" }])
    setFabric({ kg: "", costPerKg: "" }); setSewing(""); setThread(""); setPackaging(""); setOther(""); setNotes("")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Custo de Produção</h1>
        <p className="text-sm text-gray-500">Lançar produção e calcular custo por peça</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <h2 className="text-sm font-semibold text-gray-700">Nova produção</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Produto</Label>
              <select className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={selectedProduct} onChange={(e) => { setSelectedProduct(e.target.value); setItems([{ variantId: "", quantity: "" }]) }} required>
                <option value="">Selecione o produto...</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Variações produzidas</Label>
                <button type="button" onClick={addItem} className="text-xs text-blue-600 hover:underline">+ Adicionar variação</button>
              </div>
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-2 mb-2">
                  <select className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" value={item.variantId} onChange={(e) => updateItem(idx, "variantId", e.target.value)} required>
                    <option value="">Variação...</option>
                    {productVariants.map((v) => <option key={v.id} value={v.id}>{v.color} / {v.size}</option>)}
                  </select>
                  <Input type="number" placeholder="Qtd" className="w-24" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} required />
                  {items.length > 1 && <button type="button" onClick={() => removeItem(idx)} className="text-gray-400 hover:text-red-500 text-sm">✕</button>}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Kg de tecido</Label><Input className="mt-1" type="number" step="0.01" placeholder="0" value={fabric.kg} onChange={(e) => setFabric({ ...fabric, kg: e.target.value })} /></div>
              <div><Label>Custo/kg (R$)</Label><Input className="mt-1" type="number" step="0.01" placeholder="0" value={fabric.costPerKg} onChange={(e) => setFabric({ ...fabric, costPerKg: e.target.value })} /></div>
              <div><Label>Custo costura/peça (R$)</Label><Input className="mt-1" type="number" step="0.01" placeholder="0" value={sewing} onChange={(e) => setSewing(e.target.value)} /></div>
              <div><Label>Custo linha (R$)</Label><Input className="mt-1" type="number" step="0.01" placeholder="0" value={thread} onChange={(e) => setThread(e.target.value)} /></div>
              <div><Label>Custo embalagem (R$)</Label><Input className="mt-1" type="number" step="0.01" placeholder="0" value={packaging} onChange={(e) => setPackaging(e.target.value)} /></div>
              <div><Label>Outros custos (R$)</Label><Input className="mt-1" type="number" step="0.01" placeholder="0" value={other} onChange={(e) => setOther(e.target.value)} /></div>
            </div>

            <div><Label>Observações</Label><Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <Button type="submit" className="w-full">Salvar produção</Button>
          </form>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Resumo do cálculo</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Qtd total</span><span className="font-semibold">{totalQty} peças</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Custo tecido</span><span>{formatCurrency(calc.totalFabric)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Custo costura</span><span>{formatCurrency(calc.totalSewing)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Linha</span><span>{formatCurrency(Number(thread) || 0)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Embalagem</span><span>{formatCurrency(Number(packaging) || 0)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Outros</span><span>{formatCurrency(Number(other) || 0)}</span></div>
              <hr />
              <div className="flex justify-between font-bold"><span>Custo total</span><span className="text-blue-700">{formatCurrency(calc.totalCost)}</span></div>
              <div className="flex justify-between font-bold"><span>Custo/peça</span><span className="text-blue-700">{formatCurrency(calc.unitCost)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Preço venda</span><span>{formatCurrency(salePrice)}</span></div>
              <div className="flex justify-between font-semibold"><span>Lucro/peça</span><span className={calc.unitProfit >= 0 ? "text-green-700" : "text-red-700"}>{formatCurrency(calc.unitProfit)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Margem</span><span className={calc.marginPercent >= 0 ? "text-green-700" : "text-red-700"}>{calc.marginPercent.toFixed(1)}%</span></div>
            </div>
          </div>
        </div>
      </div>

      {orders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Histórico de produções</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">Produto</th>
                <th className="text-left px-5 py-3">Qtd</th>
                <th className="text-left px-5 py-3">Custo total</th>
                <th className="text-left px-5 py-3">Custo/peça</th>
                <th className="text-left px-5 py-3">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...orders].reverse().map((o) => {
                const p = products.find((x) => x.id === o.productId)
                return (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-800">{p?.name ?? o.productId}</td>
                    <td className="px-5 py-3 text-gray-600">{o.totalQuantity} peças</td>
                    <td className="px-5 py-3 text-gray-600">{formatCurrency(o.totalCost)}</td>
                    <td className="px-5 py-3 font-semibold text-blue-700">{formatCurrency(o.unitCost)}</td>
                    <td className="px-5 py-3 text-gray-400">{o.createdAt}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
