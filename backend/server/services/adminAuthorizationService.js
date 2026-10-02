import { AUTH_ERROR_CODES } from '../auth/contracts.js'

const ADMIN_ROLE_KEYS = new Set([
  'owner',
  'manager',
  'order_manager',
  'content_editor',
  'blog_writer',
])

export class AdminAuthorizationService {
  constructor(client) {
    this.client = client
  }

  async resolve(userId, { requestId } = {}) {
    if (!this.client || !userId) return null

    const { data: profile, error: profileError } = await this.client
      .from('profiles')
      .select('id,full_name,status')
      .eq('id', userId)
      .maybeSingle()

    assertAvailable(profileError, 'profiles.select', requestId)

    if (!profile || profile.status !== 'Active') return null

    const { data: assignments, error: assignmentsError } = await this.client
      .from('user_roles')
      .select('role_id,active,revoked_at,expires_at')
      .eq('user_id', userId)
      .eq('active', true)

    assertAvailable(assignmentsError, 'user_roles.select', requestId)

    // Match migration 003's canonical assignment lifecycle before inheriting permissions.
    const now = Date.now()
    const roleIds = (assignments ?? []).filter((row) =>
      row.active === true && row.revoked_at === null &&
      (row.expires_at === null || row.expires_at === 'infinity' ||
        (row.expires_at instanceof Date ? row.expires_at.getTime() > now :
          typeof row.expires_at === 'string' && Date.parse(row.expires_at) > now)),
    ).map((row) => row.role_id)

    if (!roleIds.length) return null

    const { data: roles, error: rolesError } = await this.client
      .from('roles')
      .select('id,key,name,active')
      .in('id', roleIds)
      .eq('active', true)

    assertAvailable(rolesError, 'roles.select', requestId)

    const adminRoles = (roles ?? []).filter((role) =>
      ADMIN_ROLE_KEYS.has(role.key),
    )

    if (!adminRoles.length) return null

    const { data: links, error: linksError } = await this.client
      .from('role_permissions')
      .select('permission_id')
      .in('role_id', adminRoles.map((role) => role.id))

    assertAvailable(linksError, 'role_permissions.select', requestId)

    const permissionIds = [
      ...new Set((links ?? []).map((row) => row.permission_id)),
    ]

    let permissions = []

    if (permissionIds.length) {
      const { data, error } = await this.client
        .from('permissions')
        .select('key')
        .in('id', permissionIds)

      assertAvailable(error, 'permissions.select', requestId)

      permissions = [...new Set((data ?? []).map((row) => row.key))].sort()
    }

    const primaryRole =
      adminRoles.find((role) => role.key === 'owner') ?? adminRoles[0]

    return Object.freeze({
      userId,
      name: profile.full_name || '',
      role: primaryRole.name,
      roleKey: primaryRole.key,
      permissions,
    })
  }
}

function assertAvailable(error, operation, requestId) {
  if (error) {
    // TEMPORARY server-only diagnostic; avoid logging profile, role, or permission rows.
    console.error({
      event: 'auth.admin_authorization.failed',
      operation,
      code: typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(error.code)
        ? error.code : 'unknown',
      requestId,
    })
    const unavailable = new Error('Administrator authorization is unavailable.')
    unavailable.code = AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE
    throw unavailable
  }
}
