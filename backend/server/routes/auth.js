import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { nanoid } from 'nanoid'
import { ROLE_PERMISSIONS, getPermissions } from '../config/roles.js'
import { requireAdmin, requirePermission, signAdminToken } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { readDb, updateDb, nowIso } from '../utils/database.js'
import { loginSchema, userSchema } from '../utils/schemas.js'

export const authRouter = Router()

authRouter.post('/login', validate(loginSchema), async (req, res) => {
  const db = await readDb()
  const user = db.users.find((candidate) => candidate.email.toLowerCase() === req.body.email.toLowerCase())

  if (!user || user.status !== 'Active' || !ROLE_PERMISSIONS[user.role]) {
    return res.status(401).json({ message: 'Invalid email or password.' })
  }

  const matches = await bcrypt.compare(req.body.password, user.passwordHash)
  if (!matches) {
    return res.status(401).json({ message: 'Invalid email or password.' })
  }

  await updateDb((nextDb) => {
    const match = nextDb.users.find((candidate) => candidate.id === user.id)
    if (match) match.lastLoginAt = nowIso()
  })

  const safeUser = toSafeUser(user)
  res.json({
    token: signAdminToken(user),
    user: safeUser,
    permissions: getPermissions(user.role)
  })
})

authRouter.get('/me', requireAdmin, async (req, res) => {
  const db = await readDb()
  const user = db.users.find((candidate) => candidate.id === req.admin.id)
  res.json({
    user: toSafeUser(user),
    permissions: getPermissions(user.role),
    roles: Object.keys(ROLE_PERMISSIONS)
  })
})

authRouter.post('/logout', requireAdmin, (_req, res) => {
  res.json({ message: 'Logged out.' })
})

authRouter.get('/users', requireAdmin, requirePermission('users:manage'), async (_req, res) => {
  const db = await readDb()
  res.json(db.users.map(toSafeUser))
})

authRouter.post('/users', requireAdmin, requirePermission('users:manage'), validate(userSchema), async (req, res) => {
  const result = await updateDb(async (db) => {
    const exists = db.users.some(
      (user) => user.email.toLowerCase() === req.body.email.toLowerCase()
    )
    if (exists) {
      throw Object.assign(new Error('An admin user with this email already exists.'), { status: 409 })
    }
    if (!req.body.password) {
      throw Object.assign(new Error('Password is required for new admin users.'), { status: 400 })
    }

    const user = {
      id: `user-${nanoid(8)}`,
      name: req.body.name,
      email: req.body.email,
      role: req.body.role,
      status: req.body.status,
      passwordHash: await bcrypt.hash(req.body.password, 12),
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    db.users.push(user)
    return toSafeUser(user)
  })
  res.status(201).json(result)
})

authRouter.put('/users/:id', requireAdmin, requirePermission('users:manage'), validate(userSchema.partial()), async (req, res) => {
  const result = await updateDb(async (db) => {
    const user = db.users.find((candidate) => candidate.id === req.params.id)
    if (!user) throw Object.assign(new Error('Admin user not found.'), { status: 404 })

    Object.assign(user, {
      ...req.body,
      updatedAt: nowIso()
    })

    if (req.body.password) {
      user.passwordHash = await bcrypt.hash(req.body.password, 12)
      delete user.password
    }

    return toSafeUser(user)
  })
  res.json(result)
})

authRouter.delete('/users/:id', requireAdmin, requirePermission('users:manage'), async (req, res) => {
  await updateDb((db) => {
    if (req.params.id === req.admin.id) {
      throw Object.assign(new Error('You cannot delete your own admin account.'), { status: 400 })
    }
    db.users = db.users.filter((user) => user.id !== req.params.id)
  })
  res.status(204).end()
})

function toSafeUser(user) {
  if (!user) return null
  const { passwordHash: _passwordHash, ...safeUser } = user
  return safeUser
}
