import { AUTH_ERROR_CODES } from '../auth/contracts.js'

const ADMIN_ROLE_KEYS = new Set([
  'owner_admin',
  'shop_manager',
  'order_manager',
  'content_editor',
  'blog_writer',
])

export class AdminAuthorizationService {
  constructor(client) {
    this.client = client
  }

  async resolve(userId) {
    if (!this.client || !userId) return null

    const { data: profile, error: profileError } = await this.client
      .from('profiles')
      .select('id,full_name,status')
      .eq('id', userId)
      .maybeSingle()

    assertAvailable(profileError)

    if (!profile || profile.status !== 'Active') return null

    const { data: assignments, error: assignmentsError } = await this.client
      .from('user_roles')
      .select('role_id,active')
      .eq('user_id', userId)
      .eq('active', true)

    assertAvailable(assignmentsError)

    const roleIds = (assignments ?? []).map((row) => row.role_id)

    if (!roleIds.length) return null

    const { data: roles, error: rolesError } = await this.client
      .from('roles')
      .select('id,key,name,active')
      .in('id', roleIds)
      .eq('active', true)

    assertAvailable(rolesError)

    const adminRoles = (roles ?? []).filter((role) =>
      ADMIN_ROLE_KEYS.has(role.key),
    )

    if (!adminRoles.length) return null

    const { data: links, error: linksError } = await this.client
      .from('role_permissions')
      .select('permission_id')
      .in('role_id', adminRoles.map((role) => role.id))

    assertAvailable(linksError)

    const permissionIds = [
      ...new Set((links ?? []).map((row) => row.permission_id)),
    ]

    let permissions = []

    if (permissionIds.length) {
      const { data, error } = await this.client
        .from('permissions')
        .select('key')
        .in('id', permissionIds)

      assertAvailable(error)

      permissions = [...new Set((data ?? []).map((row) => row.key))].sort()
    }

    const primaryRole =
      adminRoles.find((role) => role.key === 'owner_admin') ?? adminRoles[0]

    return Object.freeze({
      userId,
      name: profile.full_name || '',
      role: primaryRole.name,
      roleKey: primaryRole.key,
      permissions,
    })
  }
}

function assertAvailable(error) {
  if (error) {
    const unavailable = new Error('Administrator authorization is unavailable.')
    unavailable.code = AUTH_ERROR_CODES.AUTH_SERVICE_UNAVAILABLE
    throw unavailable
  }
}