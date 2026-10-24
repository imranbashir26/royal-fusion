import { useEffect, useState } from 'react'
import type { CartItem } from '../types'
import { publicTesterPacksApi, TesterPackApiError, type PublicTesterPack } from '../services/publicTesterPacksApi'

/** Read only the packs referenced by this cart, including IDs no longer in listings. */
export function useCartTesterPacks(items: CartItem[]) {
  const key = JSON.stringify([...new Set(items.flatMap(item => item.kind === 'fixed_tester_pack' || item.kind === 'configurable_tester_pack' ? [item.packId] : []))].sort())
  const [state, setState] = useState({ key: '', packs: [] as PublicTesterPack[], loading: false, error: '' })
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const ids = JSON.parse(key) as string[]
    if (!ids.length) return
    let active = true, running = false
    const load = async () => {
      if (running) return
      running = true
      setState({ key, packs: [], loading: true, error: '' })
      try {
        const result = await Promise.all(ids.map(async id => {
          try { return await publicTesterPacksApi.get(id) }
          catch (error) { if (error instanceof TesterPackApiError && error.status === 404) return null; throw error }
        }))
        if (active) setState({ key, packs: result.filter((p): p is PublicTesterPack => p !== null), loading: false, error: '' })
      } catch (error) {
        if (active) setState({ key, packs: [], loading: false, error: error instanceof Error ? error.message : 'Unable to refresh discovery packs.' })
      } finally { running = false }
    }
    void load()
    const refresh = () => { void load() }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60000)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [key, reload])
  const needed = key !== '[]'
  return {
    testerPacks: needed && state.key === key ? state.packs : [],
    packsLoading: needed && (state.key !== key || state.loading),
    packsError: needed && state.key === key ? state.error : '',
    refreshPacks: () => setReload(value => value + 1),
  }
}
