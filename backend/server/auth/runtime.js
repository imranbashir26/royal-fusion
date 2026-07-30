import { createAuthConfig, getAuthReadiness } from './config.js'
import { AuthSessionService } from '../services/authSessionService.js'
import {
  DisabledAuthGateway,
  SupabaseAuthGateway,
  createSupabaseAuthResources,
} from '../services/supabaseAuthGateway.js'
import {
  InMemorySessionRepository,
  SupabaseSessionRepository,
} from '../services/sessionRepository.js'

export function createAuthRuntime({
  env = process.env,
  config = createAuthConfig(env),
  gateway,
  repository,
  clock,
} = {}) {
  let resolvedGateway = gateway
  let resolvedRepository = repository

  if (!resolvedGateway || !resolvedRepository) {
    if (config.customerProvider === 'supabase' || config.adminProvider === 'supabase') {
      if (config.supabaseConfigured) {
        const resources = createSupabaseAuthResources(env)
        resolvedGateway ??= new SupabaseAuthGateway({
          client: resources.client,
          clientFactory: resources.clientFactory,
          flowClientFactory: resources.flowClientFactory,
          callbackUrl: config.authCallbackUrl,
        })
        resolvedRepository ??= new SupabaseSessionRepository(resources.client)
      } else {
        resolvedGateway ??= new DisabledAuthGateway()
        resolvedRepository ??= new InMemorySessionRepository()
      }
    } else {
      resolvedGateway ??= new DisabledAuthGateway()
      resolvedRepository ??= new InMemorySessionRepository()
    }
  }

  const sessionService = new AuthSessionService({
    gateway: resolvedGateway,
    repository: resolvedRepository,
    config,
    clock,
  })
  return Object.freeze({
    config,
    gateway: resolvedGateway,
    repository: resolvedRepository,
    sessionService,
    readiness: getAuthReadiness(config),
  })
}
