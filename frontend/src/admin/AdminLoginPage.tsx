import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import logo from '../assets/brand/logo.png'
import { Button } from '../components/common/Button'
import { useAdminAuth } from './AdminAuthProvider'
import { AdminAuthError } from '../services/adminAuthClient'

export function AdminLoginPage() {
  const navigate = useNavigate()
  const { login, isAdministrator, isLoading } = useAdminAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isLoading) return <div className="grid min-h-screen place-items-center bg-marble text-burgundy">Loading admin session...</div>
  if (isAdministrator) return <Navigate replace to="/admin/dashboard" />

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await login(email, password, mfaRequired ? verificationCode : undefined)
      navigate('/admin/dashboard')
    } catch (err) {
      if (err instanceof AdminAuthError && err.code === 'MFA_REQUIRED') {
        setMfaRequired(true)
        setError('Enter the six-digit code from your authenticator app.')
      } else {
        setError(err instanceof Error ? err.message : 'Unable to login.')
      }
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
        <div className="mx-auto mb-5 flex justify-center">
          <img
            src={logo}
            alt="Royal Fusion logo"
            className="h-20 w-20 object-contain drop-shadow-[0_4px_12px_rgba(75,47,34,0.08)]"
          />
        </div>
        <h1 className="text-center font-serif text-4xl font-semibold text-burgundy">
          Admin Login
        </h1>
        <p className="mt-2 text-center text-sm text-brownroyal/65">
          Use an active Royal Fusion account with an admin role.
        </p>
        <div className="mt-7">
          <label htmlFor="admin-email" className="mb-2 block text-sm font-bold text-brownroyal">
            Email
          </label>
          <span className="flex h-12 items-center gap-3 rounded-full border border-champagne/35 bg-marble px-4">
            <Mail className="h-4 w-4 shrink-0 text-oldgold" aria-hidden="true" />
            <input
              id="admin-email"
              className="min-w-0 flex-1 bg-transparent outline-none"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </span>
        </div>
        <div className="mt-4">
          <label htmlFor="admin-password" className="mb-2 block text-sm font-bold text-brownroyal">
            Password
          </label>
          <span className="flex h-12 items-center gap-3 rounded-full border border-champagne/35 bg-marble pl-4 pr-2">
            <Lock className="h-4 w-4 shrink-0 text-oldgold" aria-hidden="true" />
            <input
              id="admin-password"
              className="min-w-0 flex-1 bg-transparent pr-2 outline-none"
              onChange={(event) => setPassword(event.target.value)}
              required
              type={showPassword ? 'text' : 'password'}
              value={password}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-oldgold transition-colors hover:bg-champagne/15 hover:text-burgundy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne/70"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </span>
        </div>
        {mfaRequired && (
          <div className="mt-4">
            <label htmlFor="admin-verification-code" className="mb-2 block text-sm font-bold text-brownroyal">Authenticator code</label>
            <input
              id="admin-verification-code"
              autoComplete="one-time-code"
              className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4 outline-none focus-visible:ring-2 focus-visible:ring-champagne"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ''))}
              pattern="[0-9]{6}"
              required
              value={verificationCode}
            />
          </div>
        )}
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
