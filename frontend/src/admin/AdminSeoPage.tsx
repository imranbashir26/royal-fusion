import { useState } from 'react'
import { AdminResourceManager } from './AdminResourcePage'

export function AdminSeoPage() {
  const [mode, setMode] = useState<'seo' | 'editable-pages'>('seo')

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <button
          className={mode === 'seo' ? activeClass : inactiveClass}
          onClick={() => setMode('seo')}
          type="button"
        >
          SEO Meta
        </button>
        <button
          className={mode === 'editable-pages' ? activeClass : inactiveClass}
          onClick={() => setMode('editable-pages')}
          type="button"
        >
          Editable Pages
        </button>
      </div>
      <AdminResourceManager resource={mode} />
    </div>
  )
}

const activeClass = 'rounded-full bg-burgundy px-5 py-2 text-sm font-bold text-ivory'
const inactiveClass = 'rounded-full border border-champagne/35 bg-ivory px-5 py-2 text-sm font-bold text-brownroyal'
