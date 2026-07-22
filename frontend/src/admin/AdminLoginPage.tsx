import { Crown, Lock, Mail } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { useAdminAuth } from './AdminAuthProvider'

export function AdminLoginPage() {
  const navigate = useNavigate()
  const { login, isAuthenticated } = useAdminAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isAuthenticated) return <Navigate replace to="/admin/dashboard" />

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await login(email, password)
      navigate('/admin/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to login.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-marble px-4 py-12">
      <form
        className="w-full max-w-md rounded-lg border border-champagne/30 bg-ivory p-7 shadow-2xl shadow-brownroyal/12"
        onSubmit={handleSubmit}
      >
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-burgundy text-champagne">
          <Crown className="h-9 w-9" aria-hidden="true" />
        </div>
        <h1 className="text-center font-serif text-4xl font-semibold text-burgundy">
          Admin Login
        </h1>
        <p className="mt-2 text-center text-sm text-brownroyal/65">
          Use an active Royal Fusion account with an admin role.
        </p>
        <label className="mt-7 block">
          <span className="mb-2 block text-sm font-bold text-brownroyal">Email</span>
          <span className="flex h-12 items-center gap-3 rounded-full border border-champagne/35 bg-marble px-4">
            <Mail className="h-4 w-4 text-oldgold" />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </span>
        </label>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-bold text-brownroyal">Password</span>
          <span className="flex h-12 items-center gap-3 rounded-full border border-champagne/35 bg-marble px-4">
            <Lock className="h-4 w-4 text-oldgold" />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </span>
        </label>
        {error && (
          <p className="mt-4 rounded-lg border border-burgundy/20 bg-burgundy/8 px-4 py-3 text-sm font-semibold text-burgundy">
            {error}
          </p>
        )}
        <Button className="mt-6 w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Signing in...' : 'Login'}
        </Button>
      </form>
    </div>
  )
}
