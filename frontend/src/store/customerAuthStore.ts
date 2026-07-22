import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface CustomerProfile {
  id: string
  name: string
  email: string
  phone: string
  address: string
  city: string
  province: string
}

interface StoredCustomer extends CustomerProfile {
  passwordHash: string
  createdAt: string
  updatedAt: string
}

interface CustomerAuthState {
  customers: StoredCustomer[]
  currentCustomer: CustomerProfile | null
  signUp: (payload: SignUpPayload) => Promise<void>
  signIn: (payload: SignInPayload) => Promise<void>
  updateProfile: (payload: CustomerProfileUpdate) => void
  logout: () => void
}

interface SignUpPayload {
  name: string
  email: string
  phone: string
  password: string
}

interface SignInPayload {
  identifier: string
  password: string
}

export type CustomerProfileUpdate = Pick<
  CustomerProfile,
  'name' | 'email' | 'phone' | 'address' | 'city' | 'province'
>

export const useCustomerAuthStore = create<CustomerAuthState>()(
  persist(
    (set, get) => ({
      customers: [],
      currentCustomer: null,
      signUp: async ({ name, email, phone, password }) => {
        const normalizedEmail = normalizeEmail(email)
        const normalizedPhone = normalizePhone(phone)
        if (!normalizedEmail && !normalizedPhone) {
          throw new Error('Please provide either an email address or phone number.')
        }
        const emailExists = Boolean(normalizedEmail) && get().customers.some((customer) => customer.email === normalizedEmail)
        if (emailExists) throw new Error('An account with this email already exists.')
        const phoneExists = Boolean(normalizedPhone) && get().customers.some((customer) => normalizePhone(customer.phone) === normalizedPhone)
        if (phoneExists) throw new Error('An account with this phone number already exists.')

        const now = new Date().toISOString()
        const customer: StoredCustomer = {
          id: `customer-${crypto.randomUUID()}`,
          name: name.trim(),
          email: normalizedEmail,
          phone: normalizedPhone,
          address: '',
          city: '',
          province: '',
          passwordHash: await hashPassword(password),
          createdAt: now,
          updatedAt: now,
        }

        set((state) => ({
          customers: [customer, ...state.customers],
          currentCustomer: toProfile(customer),
        }))
      },
      signIn: async ({ identifier, password }) => {
        const normalizedIdentifier = normalizeIdentifier(identifier)
        const customer = get().customers.find(
          (item) =>
            item.email === normalizedIdentifier ||
            normalizePhone(item.phone) === normalizedIdentifier,
        )
        if (!customer || customer.passwordHash !== await hashPassword(password)) {
          throw new Error('Invalid email, phone, or password.')
        }
        set({ currentCustomer: toProfile(customer) })
      },
      updateProfile: (payload) => {
        const current = get().currentCustomer
        if (!current) throw new Error('Please sign in before updating your profile.')

        const normalizedEmail = normalizeEmail(payload.email)
        const normalizedPhone = normalizePhone(payload.phone)
        if (!normalizedEmail && !normalizedPhone) {
          throw new Error('Please keep either an email address or phone number on your profile.')
        }
        const duplicateEmail = Boolean(normalizedEmail) && get().customers.some(
          (customer) => customer.email === normalizedEmail && customer.id !== current.id,
        )
        if (duplicateEmail) throw new Error('This email is already used by another account.')
        const duplicatePhone = Boolean(normalizedPhone) && get().customers.some(
          (customer) => normalizePhone(customer.phone) === normalizedPhone && customer.id !== current.id,
        )
        if (duplicatePhone) throw new Error('This phone number is already used by another account.')

        set((state) => {
          const customers = state.customers.map((customer) =>
            customer.id === current.id
              ? {
                  ...customer,
                  ...payload,
                  email: normalizedEmail,
                  name: payload.name.trim(),
                  phone: normalizedPhone,
                  updatedAt: new Date().toISOString(),
                }
              : customer,
          )
          const updated = customers.find((customer) => customer.id === current.id)
          return {
            customers,
            currentCustomer: updated ? toProfile(updated) : current,
          }
        })
      },
      logout: () => set({ currentCustomer: null }),
    }),
    {
      name: 'royal-fusion-customer-auth',
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
)

function toProfile(customer: StoredCustomer): CustomerProfile {
  const { passwordHash: _passwordHash, createdAt: _createdAt, updatedAt: _updatedAt, ...profile } = customer
  return profile
}

async function hashPassword(password: string) {
  const bytes = new TextEncoder().encode(`royal-fusion:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, '').trim()
}

function normalizeIdentifier(identifier: string) {
  const value = identifier.trim().toLowerCase()
  return value.includes('@') ? normalizeEmail(value) : normalizePhone(value)
}
