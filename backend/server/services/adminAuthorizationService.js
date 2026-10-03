import { AUTH_ERROR_CODES } from '../auth/contracts.js'

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
      .select('role_id,active')
      .eq('user_id', userId)
      .eq('active', true)

    assertAvailable(assignmentsError, 'user_roles.select', requestId)

    const roleIds = (assignments ?? []).filter((row) => row.active === true).map((row) => row.role_id)

    if (!roleIds.length) return null

    const { data: roles, error: rolesError } = await this.client
      .from('roles')
      .select('id,key,name,active')
      .in('id', roleIds)
      .eq('active', true)

    assertAvailable(rolesError, 'roles.select', requestId)

    const adminRoles = (roles ?? []).filter((role) => role.key === 'admin' && role.active === true)

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

    if (!permissions.includes('*')) return null
    const primaryRole = adminRoles[0]

    return Object.freeze({
      userId,
      name: profile.full_name || '',
      role: primaryRole.name,
      roleKey: primaryRole.key,
      permissions: ['*'],
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
