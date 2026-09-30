import { createAuthConfig, getAuthReadiness } from './config.js'
import { AuthSessionService } from '../services/authSessionService.js'
import { AdminAuthorizationService } from '../services/adminAuthorizationService.js'
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
  adminAuthorization,
  clock,
} = {}) {
  let resolvedGateway = gateway
  let resolvedRepository = repository

  if (!resolvedGateway || !resolvedRepository) {
    if (config.customerProvider === 'supabase' || config.adminProvider === 'supabase') {
      if (config.supabaseConfigured) {
        const resources = createSupabaseAuthResources(env)
        resolvedGateway ??= new SupabaseAuthGateway({
          authClientFactory: resources.authClientFactory,
          flowClientFactory: resources.flowClientFactory,
          callbackUrl: config.authCallbackUrl,
        })
        resolvedRepository ??= new SupabaseSessionRepository(resources.privilegedDbClient)
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
  const resolvedAdminAuthorization = adminAuthorization ?? new AdminAuthorizationService(
    resolvedRepository instanceof SupabaseSessionRepository ? resolvedRepository.client : null,
  )
  return Object.freeze({
    config,
    gateway: resolvedGateway,
    repository: resolvedRepository,
    sessionService,
    adminAuthorization: resolvedAdminAuthorization,
    readiness: getAuthReadiness(config),
  })
}
