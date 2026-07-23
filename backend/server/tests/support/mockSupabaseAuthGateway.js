import { AUTH_ERROR_CODES } from '../../auth/contracts.js'

const identities = Object.freeze({
  owner: Object.freeze({ id: '00000000-0000-4000-8000-000000000101', type: 'owner', emailVerified: true }),
  manager: Object.freeze({ id: '00000000-0000-4000-8000-000000000102', type: 'manager', emailVerified: true }),
  customer: Object.freeze({ id: '00000000-0000-4000-8000-000000000103', type: 'customer', emailVerified: true }),
  unverified: Object.freeze({ id: '00000000-0000-4000-8000-000000000104', type: 'customer', emailVerified: false }),
})

export class MockSupabaseAuthGateway {
  async verifyIdentity(outcome) {
    if (outcome === 'unauthenticated') return Object.freeze({ authenticated: false })
    if (outcome === 'expired') return failure(AUTH_ERROR_CODES.SESSION_EXPIRED)
    if (outcome === 'revoked') return failure(AUTH_ERROR_CODES.SESSION_REVOKED)
    if (outcome === 'unavailable') return failure(AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
    if (identities[outcome]) {
      return Object.freeze({ authenticated: true, identity: identities[outcome] })
    }
    return failure(AUTH_ERROR_CODES.INVALID_CREDENTIALS)
  }

  async signIn(outcome) {
    if (outcome === 'unverified') {
      return failure(AUTH_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED, identities.unverified)
    }
    if (outcome === 'unavailable') return failure(AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
    if (identities[outcome]) {
      return Object.freeze({ authenticated: true, identity: identities[outcome] })
    }
    return failure(AUTH_ERROR_CODES.INVALID_CREDENTIALS)
  }

  async refresh(outcome) {
    if (outcome === 'success') {
      return Object.freeze({ refreshed: true, identity: identities.customer })
    }
    if (outcome === 'unavailable') return failure(AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
    return failure(AUTH_ERROR_CODES.SESSION_EXPIRED)
  }
}

function failure(code, identity) {
  return Object.freeze({ authenticated: false, code, ...(identity ? { identity } : {}) })
}
