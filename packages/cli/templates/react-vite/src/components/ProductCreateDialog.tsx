import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

interface CreateProductRequest {
  name: string
  category: string
  price: number
  inStock: boolean
}

async function createProduct(req: CreateProductRequest) {
  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error('Failed to create product')
  return res.json()
}

interface Props {
  open: boolean
  onClose: () => void
}

const CATEGORIES = ['Electronics', 'Furniture', 'Lighting', 'Accessories']

export function ProductCreateDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Electronics')
  const [price, setPrice] = useState('')
  const [inStock, setInStock] = useState(true)

  const mutation = useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      onClose()
      setName('')
      setPrice('')
      setCategory('Electronics')
      setInStock(true)
    },
  })

  if (!open) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !price) return
    mutation.mutate({ name: name.trim(), category, price: parseFloat(price), inStock })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">New Product</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Product name"
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Price</label>
            <input
              type="number"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="inStock"
              checked={inStock}
              onChange={e => setInStock(e.target.checked)}
              className="h-4 w-4 rounded border"
            />
            <label htmlFor="inStock" className="text-sm font-medium">In stock</label>
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-500">Failed to create product. Is the backend running?</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className={cn(
                'rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors',
                mutation.isPending ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary/90'
              )}
            >
              {mutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
