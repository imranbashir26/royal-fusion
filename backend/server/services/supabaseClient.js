import { createClient } from '@supabase/supabase-js'

const CONNECTIVITY_TABLE = 'public_site_settings'
const CONNECTIVITY_TIMEOUT_MS = 3000

let serverClient

export class SupabaseConfigurationError extends Error {
  constructor() {
    super('Supabase is enabled but its server configuration is incomplete.')
    this.name = 'SupabaseConfigurationError'
    this.status = 503
  }
}

export function isSupabaseEnabled() {
  return process.env.USE_SUPABASE?.trim().toLowerCase() === 'true'
}

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SECRET_KEY?.trim())
}

export function getDatabaseProvider() {
  return 'json'
}

export function getServerSupabaseClient() {
  if (!isSupabaseEnabled()) return null
  if (!isSupabaseConfigured()) throw new SupabaseConfigurationError()
  if (serverClient) return serverClient

  serverClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return serverClient
}

export async function checkSupabaseConnectivity(clientOverride) {
  if (!isSupabaseEnabled()) return 'disabled'
  if (!isSupabaseConfigured()) return 'unavailable'

  try {
    const client = clientOverride ?? getServerSupabaseClient()
    let query = client
      .from(CONNECTIVITY_TABLE)
      .select('key', { head: true })
      .limit(1)

    if (typeof AbortSignal.timeout === 'function') {
      query = query.abortSignal(AbortSignal.timeout(CONNECTIVITY_TIMEOUT_MS))
    }

    const { error } = await query
    return error ? 'unavailable' : 'healthy'
  } catch {
    return 'unavailable'
  }
}
