import jwt from 'jsonwebtoken'
import { hasPermission } from '../config/roles.js'
import { readDb } from '../utils/database.js'

export function signAdminToken(user) {
  const secret = getJwtSecret()
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    secret,
    { expiresIn: '8h' }
  )
}

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 24) {
    throw Object.assign(
      new Error('JWT_SECRET must be set to a long random value. See .env.example.'),
      { status: 500 }
    )
  }
  return secret
}

export async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return res.status(401).json({ message: 'Admin login required.' })

    const payload = jwt.verify(token, getJwtSecret())
    const db = await readDb()
    const user = db.users.find((candidate) => candidate.id === payload.sub)

    if (!user || user.status !== 'Active') {
      return res.status(401).json({ message: 'Admin account is inactive or missing.' })
    }

    req.admin = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }

    next()
  } catch {
    res.status(401).json({ message: 'Invalid or expired admin session.' })
  }
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ message: 'Admin login required.' })
    if (!hasPermission(req.admin.role, permission)) {
      return res.status(403).json({ message: 'You do not have permission for this action.' })
    }
    next()
  }
}
