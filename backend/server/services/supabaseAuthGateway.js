import { createClient } from '@supabase/supabase-js'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'

export class AuthGatewayError extends Error {
  constructor(code) {
    super('Authentication gateway operation failed.')
    this.name = 'AuthGatewayError'
    this.code = code
  }
}

export class SupabaseAuthGateway {
  constructor({ client, clientFactory, flowClientFactory, callbackUrl = '' }) {
    this.client = client
    this.clientFactory = clientFactory
    this.flowClientFactory = flowClientFactory
    this.callbackUrl = callbackUrl
  }

  async signUp({ email, password, fullName, phone, state }) {
    const flow = this.flowClientFactory()
    const redirect = addState(this.callbackUrl, state, 'email')
    const { error } = await callProvider(() => flow.client.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone },
        ...(redirect ? { emailRedirectTo: redirect } : {}),
      },
    }))
    if (error && !isEnumerationSafeSignupError(error)) throw mapProviderError(error)
    return Object.freeze({ accepted: true, codeVerifier: flow.readCodeVerifier() })
  }

  async signIn({ email, password }) {
    const { data, error } = await callProvider(
      () => this.client.auth.signInWithPassword({ email, password }),
    )
    if (error) throw mapProviderError(error)
    return toAuthenticatedResult(data)
  }

  async signInAdministrator({ email, password, verificationCode, requireMfa, requestId }) {
    const client = this.clientFactory()
    const { data, error } = await callProvider(
      () => client.auth.signInWithPassword({ email, password }),
      (failure) => console.error({
        event: 'auth.supabase_auth.failed',
        operation: 'signInWithPassword',
        failure: 'transport',
        code: diagnosticCode(failure?.code ?? failure?.name),
        requestId,
      }),
    )
    if (error) {
      const mapped = mapProviderError(error)
      if (mapped.code === AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE) {
        console.error({
          event: 'auth.supabase_auth.failed',
          operation: 'signInWithPassword',
          failure: 'provider',
          status: Number.isInteger(error.status) ? error.status : null,
          code: diagnosticCode(error.code),
          requestId,
        })
      }
      throw mapped
    }
    const result = toAuthenticatedResult(data)
    if (!requireMfa) return result
    const factors = await callProvider(() => client.auth.mfa.listFactors())
    if (factors.error) throw mapProviderError(factors.error)
    const factor = factors.data?.totp?.find((item) => item.status === 'verified')
    if (!factor || !verificationCode) {
      throw new AuthGatewayError(AUTH_ERROR_CODES.MFA_REQUIRED)
    }
    const verified = await callProvider(() => client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: verificationCode,
    }))
    if (verified.error) throw mapProviderError(verified.error)
    const elevated = toAuthenticatedResult({
      user: verified.data?.user ?? data.user,
      session: verified.data,
    })
    if (elevated.identity.assuranceLevel !== 'aal2') {
      throw new AuthGatewayError(AUTH_ERROR_CODES.MFA_REQUIRED)
    }
    return elevated
  }

  async verifyAccessToken(accessToken) {
    const { data, error } = await callProvider(() => this.client.auth.getUser(accessToken))
    if (error || !data?.user) throw mapProviderError(error)
    return Object.freeze({ identity: toSafeIdentity(data.user, accessToken) })
  }

  async refresh(refreshToken) {
    const { data, error } = await callProvider(
      () => this.client.auth.refreshSession({ refresh_token: refreshToken }),
    )
    if (error) throw mapProviderError(error)
    return toAuthenticatedResult(data)
  }

  async signOut({ accessToken, scope = 'local' }) {
    const { error } = await callProvider(
      () => this.client.auth.admin.signOut(accessToken, scope),
    )
    if (error && !isMissingSessionError(error)) throw mapProviderError(error)
  }

  async forgotPassword({ email, state }) {
    const flow = this.flowClientFactory()
    const redirectTo = addState(this.callbackUrl, state, 'recovery')
    const { error } = await callProvider(() => flow.client.auth.resetPasswordForEmail(email, {
      ...(redirectTo ? { redirectTo } : {}),
    }))
    if (error && !isEnumerationSafeRecoveryError(error)) throw mapProviderError(error)
    return Object.freeze({ accepted: true, codeVerifier: flow.readCodeVerifier() })
  }

  async resendVerification({ email, state }) {
    const flow = this.flowClientFactory()
    const emailRedirectTo = addState(this.callbackUrl, state, 'email')
    const { error } = await callProvider(() => flow.client.auth.resend({
      type: 'signup',
      email,
      options: { ...(emailRedirectTo ? { emailRedirectTo } : {}) },
    }))
    if (error && !isEnumerationSafeSignupError(error)) throw mapProviderError(error)
    return Object.freeze({ accepted: true, codeVerifier: flow.readCodeVerifier() })
  }

  async verifyCode({ code, type, codeVerifier }) {
    const flow = this.flowClientFactory(codeVerifier)
    const { data, error } = await callProvider(
      () => flow.client.auth.exchangeCodeForSession(code),
    )
    if (error) throw mapProviderError(error)
    const recovery = data?.redirectType === 'recovery'
    if ((type === 'recovery') !== recovery) {
      throw new AuthGatewayError(AUTH_ERROR_CODES.INVALID_CREDENTIALS)
    }
    return toAuthenticatedResult(data)
  }

  async updatePassword({ accessToken, refreshToken, newPassword }) {
    const client = this.clientFactory()
    const { error: sessionError } = await callProvider(() => client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    }))
    if (sessionError) throw mapProviderError(sessionError)
    const { error } = await callProvider(() => client.auth.updateUser({ password: newPassword }))
    if (error) throw mapProviderError(error)
  }
}

export function createSupabaseAuthGateway(env = process.env) {
  const { client, clientFactory, flowClientFactory } = createSupabaseAuthResources(env)
  return new SupabaseAuthGateway({
    client,
    clientFactory,
    flowClientFactory,
    callbackUrl: env.AUTH_CALLBACK_URL ?? '',
  })
}

export function createSupabaseAuthResources(env = process.env) {
  const url = env.SUPABASE_URL?.trim()
  const secret = env.SUPABASE_SECRET_KEY?.trim()
  if (!url || !secret) throw new AuthGatewayError(AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
  const clientFactory = () => createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const flowClientFactory = (initialCodeVerifier = '') => {
    const storage = createPkceStorage(initialCodeVerifier)
    const client = createClient(url, secret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storage,
      },
    })
    return Object.freeze({
      client,
      readCodeVerifier: () => storage.readCodeVerifier(),
    })
  }
  return Object.freeze({ client: clientFactory(), clientFactory, flowClientFactory })
}

export class DisabledAuthGateway {
  async signUp() { throw unavailable() }
  async signIn() { throw unavailable() }
  async signInAdministrator() { throw unavailable() }
  async verifyAccessToken() { throw unavailable() }
  async refresh() { throw unavailable() }
  async signOut() { throw unavailable() }
  async forgotPassword() { throw unavailable() }
  async resendVerification() { throw unavailable() }
  async verifyCode() { throw unavailable() }
  async updatePassword() { throw unavailable() }
}

function toAuthenticatedResult(data) {
  if (!data?.session || !data?.user) throw unavailable()
  return Object.freeze({
    identity: toSafeIdentity(data.user, data.session.access_token),
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    accessExpiresAt: data.session.expires_at
      ? new Date(data.session.expires_at * 1000).toISOString()
      : null,
  })
}

function toSafeIdentity(user, accessToken = '') {
  return Object.freeze({
    id: user.id,
    email: user.email ?? '',
    emailVerified: Boolean(user.email_confirmed_at),
    assuranceLevel: readAssuranceLevel(accessToken),
  })
}

function mapProviderError(error) {
  if (error instanceof AuthGatewayError) return error
  const code = String(error?.code ?? '').toLowerCase()
  if (code.includes('email_not_confirmed')) {
    return new AuthGatewayError(AUTH_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED)
  }
  if (code.includes('session') || code.includes('refresh_token')) {
    return new AuthGatewayError(AUTH_ERROR_CODES.SESSION_EXPIRED)
  }
  if (code.includes('otp') || code.includes('token_hash') || code.includes('code_verifier')) {
    return new AuthGatewayError(AUTH_ERROR_CODES.INVALID_CREDENTIALS)
  }
  if (Number(error?.status) === 429) {
    return new AuthGatewayError(AUTH_ERROR_CODES.RATE_LIMITED)
  }
  if (code.includes('invalid_credentials') || code.includes('user_not_found') ||
    Number(error?.status) === 400) {
    return new AuthGatewayError(AUTH_ERROR_CODES.INVALID_CREDENTIALS)
  }
  return unavailable()
}

function unavailable() {
  return new AuthGatewayError(AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE)
}

function isEnumerationSafeSignupError(error) {
  return isEnumerationSafeEmailStateError(error)
}

function isEnumerationSafeRecoveryError(error) {
  return isEnumerationSafeEmailStateError(error)
}

function isEnumerationSafeEmailStateError(error) {
  return [
    'user_not_found',
    'user_already_exists',
    'email_exists',
    'email_not_confirmed',
    'email_already_confirmed',
    'user_already_confirmed',
  ].includes(String(error?.code ?? '').toLowerCase())
}

function isMissingSessionError(error) {
  return String(error?.code ?? '').toLowerCase().includes('session')
}

function addState(callbackUrl, state, type) {
  if (!callbackUrl || !state) return ''
  const url = new URL(callbackUrl)
  url.searchParams.set('state', state)
  url.searchParams.set('type', type)
  return url.toString()
}

async function callProvider(operation, onTransportFailure) {
  try {
    return await operation()
  } catch (error) {
    onTransportFailure?.(error)
    if (error instanceof AuthGatewayError) throw error
    throw unavailable()
  }
}

function diagnosticCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'unknown'
}

function createPkceStorage(initialCodeVerifier) {
  const values = new Map()
  return {
    getItem(key) {
      if (values.has(key)) return values.get(key)
      return key.endsWith('-code-verifier') && initialCodeVerifier
        ? initialCodeVerifier
        : null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
    readCodeVerifier() {
      for (const [key, value] of values) {
        if (key.endsWith('-code-verifier')) return value
      }
      return initialCodeVerifier
    },
  }
}

function readAssuranceLevel(accessToken) {
  try {
    const parts = String(accessToken).split('.')
    if (parts.length !== 3) return 'aal1'
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload.aal === 'aal2' ? 'aal2' : 'aal1'
  } catch {
    return 'aal1'
  }
}
