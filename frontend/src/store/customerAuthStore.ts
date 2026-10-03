import { create } from 'zustand'
import { customerAuthClient, type CustomerProfile, type CustomerProfileUpdate } from '../services/customerAuthClient.ts'
export type { CustomerProfile, CustomerProfileUpdate } from '../services/customerAuthClient'
interface CustomerAuthState {
 currentCustomer: CustomerProfile | null
 restoreSession: () => Promise<void>
 signUp: (payload: { name: string; email: string; phone: string; password: string }) => Promise<void>
 signIn: (payload: { identifier: string; password: string }) => Promise<void>
 updateProfile: (payload: CustomerProfileUpdate) => Promise<void>
 logout: () => Promise<void>
}
let generation=0
// Memory-only presentation state; the server supplies the trusted identity.
export const useCustomerAuthStore = create<CustomerAuthState>()((set) => ({
 currentCustomer: null,
 restoreSession: async () => {
  const attempt=++generation
  try { if (typeof window !== 'undefined') window.localStorage.removeItem('royal-fusion-customer-auth') } catch { /* Storage never authorizes identity. */ }
  try { const profile=await customerAuthClient.restore(); if(attempt===generation) set({currentCustomer:profile}) }
  catch (error) { if(attempt===generation) set({ currentCustomer: null }); throw error }
 },
 signUp: payload => customerAuthClient.signUp(payload),
 signIn: async payload => { const attempt=++generation; set({currentCustomer:null}); const profile=await customerAuthClient.signIn(payload); if(attempt===generation) set({currentCustomer:profile}) },
 updateProfile: async payload => { const attempt=++generation; try { const profile=await customerAuthClient.updateProfile(payload); if(attempt===generation) set({currentCustomer:profile}) } catch(error) { if(attempt===generation) set({currentCustomer:null}); throw error } },
 logout: async () => { ++generation; set({currentCustomer:null}); await customerAuthClient.logout() },
}))
