import { AnimatePresence, motion } from 'framer-motion'
import { LogOut, Mail, Phone, ShieldCheck, User, X } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../../admin/AdminAuthProvider'
import { Button } from '../common/Button'
import { useCustomerAuthStore, type CustomerProfileUpdate } from '../../store/customerAuthStore'
import { cn } from '../../utils/cn'

interface AccountModalProps {
  isOpen: boolean
  onClose: () => void
}

type AccountMode = 'signin' | 'signup'
type FieldErrors = Partial<Record<string, string>>

const emptyAuthForm = {
  name: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
}

export function AccountModal({ isOpen, onClose }: AccountModalProps) {
  const navigate = useNavigate()
  const { login: adminLogin } = useAdminAuth()
  const currentCustomer = useCustomerAuthStore((state) => state.currentCustomer)
  const signIn = useCustomerAuthStore((state) => state.signIn)
  const signUp = useCustomerAuthStore((state) => state.signUp)
  const updateProfile = useCustomerAuthStore((state) => state.updateProfile)
  const logout = useCustomerAuthStore((state) => state.logout)
  const [mode, setMode] = useState<AccountMode>('signin')
  const [authForm, setAuthForm] = useState(emptyAuthForm)
  const [profileForm, setProfileForm] = useState<CustomerProfileUpdate>({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    province: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setErrors({})
    setMessage('')
  }, [isOpen, mode])

  useEffect(() => {
    if (!currentCustomer) return
    setProfileForm({
      name: currentCustomer.name,
      email: currentCustomer.email,
      phone: currentCustomer.phone,
      address: currentCustomer.address,
      city: currentCustomer.city,
      province: currentCustomer.province,
    })
  }, [currentCustomer])

  const panelTitle = useMemo(() => {
    if (currentCustomer) return 'Your Royal Profile'
    return mode === 'signin' ? 'Sign in to Royal Fusion' : 'Create your account'
  }, [currentCustomer, mode])

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validation = validateAuthForm(authForm, mode)
    setErrors(validation)
    setMessage('')
    if (Object.keys(validation).length > 0) return

    setIsSaving(true)
    try {
      if (mode === 'signin') {
        if (authForm.email.includes('@')) {
          const didLoginAsAdmin = await tryAdminLogin(adminLogin, authForm.email, authForm.password)
          if (didLoginAsAdmin) {
            onClose()
            navigate('/admin/dashboard')
            return
          }
        }
        await signIn({ identifier: authForm.email, password: authForm.password })
        setMessage('Welcome back. Your profile is ready.')
      } else {
        await signUp({
          name: authForm.name,
          email: authForm.email,
          phone: authForm.phone,
          password: authForm.password,
        })
        setMessage('Account created successfully.')
      }
      setAuthForm(emptyAuthForm)
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Unable to continue.' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleProfileSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validation = validateProfileForm(profileForm)
    setErrors(validation)
    setMessage('')
    if (Object.keys(validation).length > 0) return

    try {
      updateProfile(profileForm)
      setMessage('Profile updated successfully.')
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Unable to update profile.' })
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[65] bg-brownroyal/45 p-3 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.aside
            aria-label="Customer account"
            className="ml-auto flex h-full w-full max-w-md flex-col overflow-hidden rounded-lg border border-champagne/35 bg-ivory shadow-2xl"
            initial={{ x: 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 48, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-champagne/25 bg-marble px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-oldgold">Account</p>
                <h2 className="mt-1 font-serif text-3xl font-semibold text-burgundy">{panelTitle}</h2>
              </div>
              <button
                aria-label="Close account panel"
                className="grid h-10 w-10 place-items-center rounded-full border border-champagne/35 text-brownroyal transition hover:bg-champagne/15"
                onClick={onClose}
                type="button"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {currentCustomer ? (
                <form className="space-y-4" onSubmit={handleProfileSubmit}>
                  <ProfileHeader
                    email={currentCustomer.email}
                    name={currentCustomer.name}
                    phone={currentCustomer.phone}
                  />
                  <Field
                    error={errors.name}
                    label="Full name"
                    onChange={(value) => setProfileForm((current) => ({ ...current, name: value }))}
                    required
                    value={profileForm.name}
                  />
                  <Field
                    error={errors.email}
                    label="Email address (optional)"
                    onChange={(value) => setProfileForm((current) => ({ ...current, email: value }))}
                    type="email"
                    value={profileForm.email}
                  />
                  <Field
                    error={errors.phone}
                    label="Phone number (optional)"
                    onChange={(value) => setProfileForm((current) => ({ ...current, phone: value }))}
                    value={profileForm.phone}
                  />
                  <Field
                    error={errors.address}
                    label="Shipping address"
                    onChange={(value) => setProfileForm((current) => ({ ...current, address: value }))}
                    value={profileForm.address}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      error={errors.city}
                      label="City"
                      onChange={(value) => setProfileForm((current) => ({ ...current, city: value }))}
                      value={profileForm.city}
                    />
                    <Field
                      error={errors.province}
                      label="Province"
                      onChange={(value) => setProfileForm((current) => ({ ...current, province: value }))}
                      value={profileForm.province}
                    />
                  </div>
                  <Alert errors={errors} message={message} />
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button className="flex-1" type="submit">Update Profile</Button>
                    <Button
                      className="flex-1"
                      onClick={() => {
                        logout()
                        setMessage('')
                      }}
                      variant="outline"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Logout
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mb-5 grid grid-cols-2 rounded-full border border-champagne/30 bg-marble p-1">
                    {(['signin', 'signup'] as AccountMode[]).map((item) => (
                      <button
                        className={cn(
                          'rounded-full px-4 py-2 text-sm font-bold transition',
                          mode === item ? 'bg-burgundy text-ivory shadow-sm' : 'text-brownroyal hover:bg-champagne/12',
                        )}
                        key={item}
                        onClick={() => setMode(item)}
                        type="button"
                      >
                        {item === 'signin' ? 'Sign In' : 'Sign Up'}
                      </button>
                    ))}
                  </div>
                  <form className="space-y-4" onSubmit={handleAuthSubmit}>
                    {mode === 'signup' && (
                      <>
                        <Field
                          error={errors.name}
                          label="Full name"
                          onChange={(value) => setAuthForm((current) => ({ ...current, name: value }))}
                          required
                          value={authForm.name}
                        />
                        <Field
                          error={errors.phone}
                          label="Phone number (optional)"
                          onChange={(value) => setAuthForm((current) => ({ ...current, phone: value }))}
                          value={authForm.phone}
                        />
                      </>
                    )}
                    <Field
                      error={errors.email}
                      label={mode === 'signin' ? 'Email or phone number' : 'Email address (optional)'}
                      onChange={(value) => setAuthForm((current) => ({ ...current, email: value }))}
                      required={mode === 'signin'}
                      type={mode === 'signin' ? 'text' : 'email'}
                      value={authForm.email}
                    />
                    <Field
                      error={errors.password}
                      label="Password"
                      onChange={(value) => setAuthForm((current) => ({ ...current, password: value }))}
                      required
                      type="password"
                      value={authForm.password}
                    />
                    {mode === 'signup' && (
                      <Field
                        error={errors.confirmPassword}
                        label="Confirm password"
                        onChange={(value) => setAuthForm((current) => ({ ...current, confirmPassword: value }))}
                        required
                        type="password"
                        value={authForm.confirmPassword}
                      />
                    )}
                    <div className="rounded-lg border border-champagne/25 bg-marble p-4 text-sm leading-6 text-brownroyal/72">
                      <ShieldCheck className="mb-2 h-5 w-5 text-oldgold" aria-hidden="true" />
                      Passwords are validated and hashed locally for this prototype.
                    </div>
                    <Alert errors={errors} message={message} />
                    <Button className="w-full" disabled={isSaving} type="submit">
                      {isSaving ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
                    </Button>
                  </form>
                </>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

async function tryAdminLogin(
  adminLogin: (email: string, password: string) => Promise<void>,
  email: string,
  password: string,
) {
  try {
    await adminLogin(email.trim(), password)
    return true
  } catch {
    return false
  }
}

function ProfileHeader({ name, email, phone }: { name: string; email: string; phone: string }) {
  const primaryContact = email || phone
  return (
    <div className="rounded-lg border border-champagne/25 bg-marble p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-burgundy text-ivory">
          <User className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="font-serif text-2xl font-semibold text-burgundy">{name}</p>
          <p className="flex items-center gap-2 text-sm text-brownroyal/70">
            {email ? <Mail className="h-4 w-4" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}
            {primaryContact}
          </p>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  error,
  type = 'text',
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  type?: 'text' | 'email' | 'password'
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-brownroyal">
        {label}
        {required && <span className="text-burgundy"> *</span>}
      </span>
      <input
        className={cn(
          'h-12 w-full rounded-full border bg-marble px-4 outline-none transition focus:border-burgundy',
          error ? 'border-burgundy' : 'border-champagne/35',
        )}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
      {error && <span className="mt-1 block text-xs font-semibold text-burgundy">{error}</span>}
    </label>
  )
}

function Alert({ errors, message }: { errors: FieldErrors; message: string }) {
  if (errors.form) {
    return <p className="rounded-lg border border-burgundy/20 bg-burgundy/8 px-4 py-3 text-sm font-semibold text-burgundy">{errors.form}</p>
  }
  if (message) {
    return <p className="rounded-lg border border-[#2f8f5b]/20 bg-[#2f8f5b]/10 px-4 py-3 text-sm font-semibold text-[#2f8f5b]">{message}</p>
  }
  return null
}

function validateAuthForm(form: typeof emptyAuthForm, mode: AccountMode) {
  const errors: FieldErrors = {}
  if (mode === 'signup' && form.name.trim().length < 2) errors.name = 'Enter your full name.'
  if (mode === 'signin' && !form.email.trim()) errors.email = 'Enter your email or phone number.'
  if (mode === 'signup' && !hasContactMethod(form)) errors.form = 'Enter either an email address or phone number.'
  if (form.email.trim() && !isValidEmail(form.email)) errors.email = 'Enter a valid email address.'
  if (form.phone.trim() && !isValidPhone(form.phone)) errors.phone = 'Enter a valid phone number.'
  if (!isStrongPassword(form.password)) {
    errors.password = 'Use 8+ characters with uppercase, lowercase, number, and symbol.'
  }
  if (mode === 'signup' && form.password !== form.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.'
  }
  return errors
}

function validateProfileForm(form: CustomerProfileUpdate) {
  const errors: FieldErrors = {}
  if (form.name.trim().length < 2) errors.name = 'Enter your full name.'
  if (!hasContactMethod(form)) errors.form = 'Keep either an email address or phone number on your profile.'
  if (form.email.trim() && !isValidEmail(form.email)) errors.email = 'Enter a valid email address.'
  if (form.phone.trim() && !isValidPhone(form.phone)) errors.phone = 'Enter a valid phone number.'
  if (form.address && form.address.trim().length < 5) errors.address = 'Address is too short.'
  if (form.city && form.city.trim().length < 2) errors.city = 'City is too short.'
  if (form.province && form.province.trim().length < 2) errors.province = 'Province is too short.'
  return errors
}

function hasContactMethod(value: { email: string; phone: string }) {
  return Boolean(value.email.trim() || value.phone.trim())
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function isValidPhone(value: string) {
  return /^\+?[0-9\s().-]{7,20}$/.test(value.trim())
}

function isStrongPassword(value: string) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(value)
}
