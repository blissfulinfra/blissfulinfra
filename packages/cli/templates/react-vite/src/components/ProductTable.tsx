import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { ProductCreateDialog } from './ProductCreateDialog'

interface Product {
  id: number
  name: string
  category: string
  price: number
  inStock: boolean
  createdAt: string
}

interface ProductsResponse {
  products: Product[]
  total: number
}

const CATEGORIES = ['All', 'Electronics', 'Furniture', 'Lighting', 'Accessories']

async function fetchProducts(category?: string, inStock?: boolean): Promise<ProductsResponse> {
  const params = new URLSearchParams()
  if (category) params.set('category', category)
  if (inStock !== undefined) params.set('inStock', String(inStock))
  const res = await fetch(`/api/products${params.size ? `?${params}` : ''}`)
  if (!res.ok) throw new Error('Failed to fetch products')
  return res.json()
}

export function ProductTable() {
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'out'>('all')
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['products', categoryFilter, stockFilter],
    queryFn: () =>
      fetchProducts(
        categoryFilter !== 'All' ? categoryFilter : undefined,
        stockFilter === 'in' ? true : stockFilter === 'out' ? false : undefined,
      ),
  })

  return (
    <>
    <ProductCreateDialog open={showCreate} onClose={() => setShowCreate(false)} />
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b">
        <div>
          <h3 className="font-semibold">Products</h3>
          <p className="text-xs text-muted-foreground">
            Seeded from Flyway migration · {data?.total ?? '—'} items
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + New
          </button>
          {/* Category filter */}
          <div className="flex rounded-md border overflow-hidden text-xs">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  categoryFilter === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted'
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Stock filter */}
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(['all', 'in', 'out'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStockFilter(s)}
                className={cn(
                  'px-3 py-1.5 capitalize transition-colors',
                  stockFilter === s
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted'
                )}
              >
                {s === 'all' ? 'All stock' : s === 'in' ? 'In stock' : 'Out of stock'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
              <th className="px-5 py-3 text-left font-medium">Name</th>
              <th className="px-5 py-3 text-left font-medium">Category</th>
              <th className="px-5 py-3 text-right font-medium">Price</th>
              <th className="px-5 py-3 text-center font-medium">Stock</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-red-500">
                  Failed to load products — is the backend running?
                </td>
              </tr>
            )}
            {data?.products.map((p, i) => (
              <tr
                key={p.id}
                className={cn(
                  'border-b last:border-0 transition-colors hover:bg-muted/30',
                  i % 2 === 0 ? '' : 'bg-muted/10'
                )}
              >
                <td className="px-5 py-3 font-medium">{p.name}</td>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
                    {p.category}
                  </span>
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  ${p.price.toFixed(2)}
                </td>
                <td className="px-5 py-3 text-center">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                      p.inStock
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', p.inStock ? 'bg-green-500' : 'bg-red-500')} />
                    {p.inStock ? 'In stock' : 'Out of stock'}
                  </span>
                </td>
              </tr>
            ))}
            {data?.products.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                  No products match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </>
  )
}
