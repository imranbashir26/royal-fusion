import { resolveCartItem } from '../services/productVariants'
import { Landmark, PackageCheck, Wallet } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { PageHeader } from '../components/common/PageHeader'
import { orderService } from '../services/orderService'
import { CheckoutClientError } from '../services/checkoutClient'
import { checkoutCompletionAvailable, useCartStore } from '../store/cartStore'
import { useCheckoutIntentStore } from '../store/checkoutIntentStore'
import { useStorefront } from '../storefront/StorefrontProvider'
import type { CanonicalOrderRequest, CheckoutPaymentMethod, CheckoutQuoteResponse } from '../types'
import { cn } from '../utils/cn'
import { formatCurrency } from '../utils/format'

export function CheckoutPage() {
  const { products, payments, isLoading } = useStorefront()
  const { items, selectedLineIds, removeItems, capturePurchase } = useCartStore()
  const { intent, recovery, pendingReceipt, freeze, complete, newAttempt } = useCheckoutIntentStore()
  const completionAvailable = checkoutCompletionAvailable()
  const navigate = useNavigate()
  const selectedLineIdSet = new Set(selectedLineIds)
  const selectedCartItems = items.filter((item) => selectedLineIdSet.has(item.lineId))
  const enrichedItems = selectedCartItems.map((item) => resolveCartItem(item, products))
  const eligible = !isLoading && enrichedItems.length > 0 && enrichedItems.every((item) => item.eligible)
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', city: '', province: '', notes: '' })
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>('Cash on Delivery')
  const [couponCode, setCouponCode] = useState('')
  const [quote, setQuote] = useState<{ signature: string; data: CheckoutQuoteResponse; at: number } | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [orderError, setOrderError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inFlight = useRef(false)
  const signature = JSON.stringify({ items: enrichedItems.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
    shipping: { city: form.city.trim(), province: form.province.trim() }, email: form.email.trim().toLowerCase(), couponCode: couponCode.trim().toUpperCase() })
  const currentQuote = quote?.signature === signature ? quote.data : null
  const configuredPaymentMethods = useMemo(() => payments
    .filter((payment) => payment.active !== false && (payment.name === 'Cash on Delivery' || payment.name === 'Bank Transfer'))
    .map((payment) => ({ label: payment.name as CheckoutPaymentMethod, icon: payment.name === 'Bank Transfer' ? Landmark : Wallet })), [payments])
  const activePaymentMethods = configuredPaymentMethods.filter((method) => !currentQuote || currentQuote.paymentMethods.includes(method.label))
  const checkoutBlocked = !completionAvailable || !eligible || !currentQuote || !currentQuote.orderingEnabled || !activePaymentMethods.some((method) => method.label === paymentMethod)

  useEffect(() => {
    if (!activePaymentMethods.some((method) => method.label === paymentMethod) && activePaymentMethods[0]) setPaymentMethod(activePaymentMethods[0].label)
  }, [activePaymentMethods, paymentMethod])
  useEffect(() => {
    if (!eligible || intent || form.city.trim().length < 2 || form.province.trim().length < 2) return
    let active = true, running = false
    const load = async () => {
      if (running || !active) return
      running = true
      try {
        const data = await orderService.quote(JSON.parse(signature))
        if (active) { setQuote({ signature, data, at: Date.now() }); setQuoteError('') }
      } catch (error) {
        if (active) { setQuote(null); setQuoteError(error instanceof Error ? error.message : 'Unable to calculate checkout amounts.') }
      } finally { running = false }
    }
    const timer = window.setTimeout(() => void load(), 350)
    const interval = window.setInterval(() => void load(), 60000)
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(interval) }
  }, [signature, eligible, intent, form.city, form.province])

  async function submitFrozen() {
    if (inFlight.current) return
    const frozen = useCheckoutIntentStore.getState().intent
    if (!frozen) return
    inFlight.current = true; setIsSubmitting(true); setOrderError('')
    try {
      const result = await orderService.createOrder(frozen.request)
      await complete(result) // Completion binds the receipt to this frozen attempt and consumes once.
      navigate('/checkout/success', { replace: true })
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : 'Your order could not be confirmed. Your cart has been saved.')
      if (error instanceof CheckoutClientError && error.unknownOutcome) setOrderError(`${error.message} Retry the saved attempt; do not start another order.`)
    } finally { inFlight.current = false; setIsSubmitting(false) }
  }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    if (useCheckoutIntentStore.getState().intent) return submitFrozen()
    if (useCheckoutIntentStore.getState().recovery) { setOrderError('The saved attempt requires recovery before starting another order.'); return }
    if (!checkoutCompletionAvailable()) { setOrderError('Checkout is unavailable in this browser. Your cart has been saved; no order was submitted.'); return }
    if (checkoutBlocked || !quote || Date.now() - quote.at > 120000) { setOrderError('Check selected variants, destination, payment method and current quote before ordering. Your cart has been saved.'); return }
    const contact = { name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim() }
    const shipping = { address: form.address.trim(), city: form.city.trim(), province: form.province.trim(), notes: form.notes.trim() }
    if (contact.name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) || contact.phone.length < 7 || shipping.address.length < 4) {
      setOrderError('Please complete valid contact and shipping information.'); return
    }
    const request: Omit<CanonicalOrderRequest, 'idempotencyKey'> = {
      items: enrichedItems.map((item) => ({ variantId: item.variant!.id, quantity: item.quantity })),
      contact, shipping, paymentMethod, couponCode: couponCode.trim().toUpperCase(),
    }
    try {
      freeze(request, capturePurchase(enrichedItems.map((item) => ({ lineId: item.lineId, variantId: item.variant!.id, quantity: item.quantity }))))
      await submitFrozen()
    } catch { setOrderError('Your checkout attempt could not be saved. Your cart has been kept; no order was submitted.') }
  }
  if (intent || recovery) return <section className="container-lux py-16">
    <h1 className="font-serif text-3xl text-burgundy">Saved checkout attempt</h1>
    <p className="my-4">Retry this saved request to confirm its result. It keeps the same items and checkout token even if the catalog has changed.</p>
    {recovery && <p role="status" className="my-4">{recovery.reason}</p>}
    {!completionAvailable && <p role="status" className="my-4">Recovery required: checkout completion is unavailable in this browser. Your saved checkout token and cart have been kept. Retry only to confirm this order's result.</p>}
    {pendingReceipt && <p role="status" className="my-4">Order received: {pendingReceipt.orderNumber}. Cart cleanup requires recovery; do not start another order.</p>}
    {orderError && <p role="alert" className="my-4 text-burgundy">{orderError}</p>}
    {intent && <Button disabled={isSubmitting} onClick={() => void submitFrozen()}>{isSubmitting ? 'Confirming...' : 'Retry saved attempt'}</Button>}
    <Button className="ml-4" variant="outline" onClick={() => {
      if (window.confirm('An unconfirmed attempt may already have created an order. Starting again can create another order. Retry first. Start a new attempt anyway?')) { newAttempt(); setOrderError('') }
    }} disabled={isSubmitting || !completionAvailable}>Start a new attempt</Button>
  </section>
  if (isLoading) return <section className="container-lux py-16" role="status">Loading checkout catalog...</section>
  if (!items.length && !isLoading) return <Navigate replace to="/shop" />
  if (!selectedCartItems.length && !isLoading) return <section className="container-lux py-16"><h1 className="font-serif text-3xl">Select cart items to check out</h1><Link to="/cart">Return to cart</Link></section>
  const amount = (field: 'subtotal' | 'discount' | 'shippingFee' | 'total') => currentQuote ? formatCurrency(currentQuote[field]) : 'Waiting for quote'
  return <>
    <PageHeader eyebrow="Checkout" title="Complete Your Royal Order" description="Review your selected fragrances and delivery details." />
    <section className="container-lux grid gap-8 py-12 md:py-16 lg:grid-cols-[1fr_380px]">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <CheckoutPanel title="Contact Details">
          <Field label="Full Name" value={form.name} minLength={2} maxLength={120} onChange={(name) => setForm((current) => ({ ...current, name }))} />
          <Field label="Email" type="email" value={form.email} maxLength={254} onChange={(email) => setForm((current) => ({ ...current, email }))} />
          <Field label="Phone" type="tel" value={form.phone} minLength={7} maxLength={40} onChange={(phone) => setForm((current) => ({ ...current, phone }))} />
        </CheckoutPanel>
        <CheckoutPanel title="Shipping Details">
          <Field label="Address" value={form.address} minLength={4} maxLength={500} onChange={(address) => setForm((current) => ({ ...current, address }))} />
          <Field label="City" value={form.city} minLength={2} maxLength={100} onChange={(city) => setForm((current) => ({ ...current, city }))} />
          <Field label="Province / Region" value={form.province} minLength={2} maxLength={100} onChange={(province) => setForm((current) => ({ ...current, province }))} />
          <Field label="Order Notes" value={form.notes} maxLength={1000} required={false} onChange={(notes) => setForm((current) => ({ ...current, notes }))} />
        </CheckoutPanel>
        <CheckoutPanel title="Payment Method"><div className="grid gap-3 md:grid-cols-2">
          {activePaymentMethods.map((method) => <button type="button" key={method.label} onClick={() => setPaymentMethod(method.label)} className={cn('rounded-lg border p-4 text-left', paymentMethod === method.label ? 'bg-burgundy text-ivory' : 'bg-marble text-brownroyal')}>
            <method.icon className="mb-3 h-6 w-6" aria-hidden="true" /><span>{method.label}</span>
          </button>)}
        </div></CheckoutPanel>
        <CheckoutPanel title="Coupon"><Field label="Coupon code" value={couponCode} maxLength={40} required={false} onChange={(value) => setCouponCode(value.toUpperCase())} /></CheckoutPanel>
        {checkoutBlocked && <p role="status">{!completionAvailable ? 'Checkout is unavailable in this browser. Your cart has been saved; no order was submitted.' : currentQuote?.orderingEnabled === false ? 'Ordering is temporarily unavailable. Your cart has been saved.' : 'Complete your destination and resolve unavailable items to receive a checkout quote.'}</p>}
        {quoteError && <p role="alert" className="text-burgundy">{quoteError}</p>}
        {orderError && <p role="alert" className="text-burgundy">{orderError}</p>}
        <Button disabled={checkoutBlocked || isSubmitting || activePaymentMethods.length === 0} size="lg" type="submit"><PackageCheck className="h-5 w-5" aria-hidden="true" />{isSubmitting ? 'Placing Order...' : 'Place Order'}</Button>
      </form>
      <aside className="h-fit rounded-lg border border-champagne/25 bg-ivory/90 p-6 lg:sticky lg:top-24">
        <h2 className="font-serif text-3xl text-burgundy">Order Summary</h2>
        <div className="mt-5 space-y-4">{enrichedItems.map((item) => <div className="border-b border-champagne/20 pb-3" key={item.lineId}>
          <p className="font-semibold">{item.product.name}</p><p>{item.size} x {item.quantity}</p>
          {item.message && <p className="text-burgundy">{item.message}</p>}
          <p>{item.lineAmount === null ? 'Unavailable' : formatCurrency(item.lineAmount)}</p>
          <button type="button" className="text-burgundy underline" aria-label={`Remove ${item.product.name}`} onClick={() => removeItems([item.lineId])}>Remove</button>
        </div>)}</div>
        <dl className="mt-5 space-y-3">{(['subtotal', 'discount', 'shippingFee', 'total'] as const).map((field) => <div className="flex justify-between" key={field}><dt>{({ subtotal: 'Subtotal', discount: 'Discount', shippingFee: 'Shipping', total: 'Total' })[field]}</dt><dd>{amount(field)}</dd></div>)}</dl>
      </aside>
    </section>
  </>
}
function CheckoutPanel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-lg border border-champagne/25 bg-ivory p-6"><h2 className="mb-5 font-serif text-3xl text-burgundy">{title}</h2><div className="grid gap-4">{children}</div></section>
}
function Field({ label, value, onChange, type = 'text', required = true, minLength, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; minLength?: number; maxLength?: number
}) {
  return <label><span className="mb-2 block font-bold">{label}</span><input className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4" value={value} type={type} required={required} minLength={minLength} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /></label>
}
