import { useState } from 'react'
import { AdminResourceManager } from './AdminResourcePage'
import { AdminSeoSettingsPage } from './AdminPhase3Pages'

export function AdminSeoPage({ initialMode = 'seo' }: { initialMode?: 'seo' | 'editable-pages' }) {
  const [mode, setMode] = useState(initialMode)

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <button
          aria-pressed={mode === 'seo'}
          className={mode === 'seo' ? activeClass : inactiveClass}
          onClick={() => setMode('seo')}
          type="button"
        >
          SEO Meta
        </button>
        <button
          aria-pressed={mode === 'editable-pages'}
          className={mode === 'editable-pages' ? activeClass : inactiveClass}
          onClick={() => setMode('editable-pages')}
          type="button"
        >
          Editable Pages
        </button>
      </div>
      {mode === 'seo' ? <AdminSeoSettingsPage /> : <AdminResourceManager resource="editable-pages" />}
    </div>
  )
}

const activeClass = 'rounded-full bg-burgundy px-5 py-2 text-sm font-bold text-ivory'
const inactiveClass = 'rounded-full border border-champagne/35 bg-ivory px-5 py-2 text-sm font-bold text-brownroyal'
