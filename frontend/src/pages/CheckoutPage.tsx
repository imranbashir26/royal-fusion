import { CheckCircle2, CreditCard, Landmark, PackageCheck, Wallet } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { PageHeader } from '../components/common/PageHeader'
import { orderService } from '../services/orderService'
import { useCartStore } from '../store/cartStore'
import { useStorefront } from '../storefront/StorefrontProvider'
import type { OrderPayload } from '../types'
import { buttonClasses } from '../utils/buttonClasses'
import { cn } from '../utils/cn'
import { formatCurrency } from '../utils/format'

const paymentMethods: Array<{
  label: OrderPayload['paymentMethod']
  icon: typeof Wallet
  description: string
}> = [
  {
    label: 'Cash on Delivery',
    icon: Wallet,
    description: 'Pay when your order arrives.',
  },
  {
    label: 'Bank Transfer',
    icon: Landmark,
    description: 'Receive transfer instructions after order.',
  },
  {
    label: 'Card',
    icon: CreditCard,
    description: 'Card payment placeholder for future gateway.',
  },
]

export function CheckoutPage() {
  const { products, payments, shipping } = useStorefront()
  const { items, selectedLineIds, removeItems } = useCartStore()
  const selectedLineIdSet = new Set(selectedLineIds)
  const [paymentMethod, setPaymentMethod] = useState<OrderPayload['paymentMethod']>('Cash on Delivery')
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    province: '',
    notes: '',
  })
  const [couponCode, setCouponCode] = useState('')
  const [couponMessage, setCouponMessage] = useState('')
  const [discount, setDiscount] = useState(0)
  const [shippingFee, setShippingFee] = useState(Number(shipping.defaultShippingFee ?? 0))
  const [success, setSuccess] = useState<{ id: string; message: string } | null>(null)
  const [orderError, setOrderError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const selectedCartItems = items.filter((item) => selectedLineIdSet.has(item.lineId))
  const enrichedItems = selectedCartItems
    .map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId)
      const size = product?.sizeOptions.find((option) => option.value === item.size)
      return product ? { ...item, product, unitPrice: size?.price ?? product.price } : null
    })
    .filter(Boolean)

  const subtotal = enrichedItems.reduce(
    (total, item) => total + item!.unitPrice * item!.quantity,
    0,
  )
  const selectedQuantity = enrichedItems.reduce((total, item) => total + item!.quantity, 0)
  const selectedItemsSignature = selectedCartItems
    .map((item) => `${item.lineId}:${item.quantity}`)
    .join('|')
  const effectiveShippingFee =
    subtotal - discount >= Number(shipping.freeShippingAbove ?? Number.POSITIVE_INFINITY)
      ? 0
      : shippingFee
  const orderTotal = Math.max(0, subtotal - discount + effectiveShippingFee)
  const activePaymentMethods =
    payments.length > 0
      ? payments.map((payment) => ({
          label: String(payment.name) as OrderPayload['paymentMethod'],
          icon: Wallet,
          description: String(payment.instructions ?? ''),
        }))
      : paymentMethods

  useEffect(() => {
    setDiscount(0)
    setCouponMessage('')
    setShippingFee(Number(shipping.defaultShippingFee ?? 0))
  }, [selectedItemsSignature, shipping.defaultShippingFee])

  const validateCoupon = async () => {
    if (!couponCode.trim()) return
    try {
      const response = await orderService.validateCoupon({
        code: couponCode,
        subtotal,
        productIds: enrichedItems.map((item) => item!.product.id),
        categories: enrichedItems.map((item) => item!.product.category),
        city: form.city,
        province: form.province,
      })
      setDiscount(response.discount)
      setShippingFee(response.shippingFee)
      setCouponMessage('Coupon applied successfully.')
    } catch (err) {
      setDiscount(0)
      setCouponMessage(err instanceof Error ? err.message : 'Coupon is not valid.')
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting || enrichedItems.length === 0) return

    setOrderError('')
    setIsSubmitting(true)
    const orderedLineIds = enrichedItems.map((item) => item!.lineId)

    try {
      const response = await orderService.createOrder({
        items: enrichedItems.map((item) => ({
          productId: item!.productId,
          size: item!.size,
          quantity: item!.quantity,
        })),
        contact: {
          name: form.name,
          email: form.email,
          phone: form.phone,
        },
        shipping: {
          address: form.address,
          city: form.city,
          province: form.province,
          notes: form.notes,
        },
        paymentMethod,
        couponCode,
      })
      setSuccess({ id: response.id, message: response.message })
      removeItems(orderedLineIds)
    } catch {
      setOrderError(
        "We couldn't place your order. Please try again. Your cart and checkout details have been kept.",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (success) {
    return (
      <>
        <PageHeader
          description="Your order has been confirmed successfully."
          eyebrow="Order Confirmed"
          title="A Royal Package Is Being Prepared"
        />
        <section className="container-lux py-12">
          <div className="marble-panel rounded-lg p-8 text-center">
            <CheckCircle2 className="mx-auto h-16 w-16 text-[#2f8f5b]" aria-hidden="true" />
            <h2 className="mt-5 font-serif text-4xl font-semibold text-burgundy">{success.message}</h2>
            <p className="mt-3 text-brownroyal/70">Order ID: {success.id}</p>
            <Link className={buttonClasses({ className: 'mt-7' })} to="/shop">
              Continue Shopping
            </Link>
          </div>
        </section>
      </>
    )
  }

  if (enrichedItems.length === 0) {
    return (
      <Navigate
        replace
        state={{ cartMessage: 'Select at least one product to continue.' }}
        to="/cart"
      />
    )
  }

  return (
    <>
      <PageHeader
        description="A complete frontend checkout UI with contact details, shipping, payment method selection, and order summary."
        eyebrow="Checkout"
        title="Complete Your Royal Order"
      />
      <section className="container-lux grid gap-8 py-12 md:py-16 lg:grid-cols-[1fr_380px]">
        <form className="space-y-6" onSubmit={handleSubmit}>
          <CheckoutPanel title="Contact Details">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Full Name" onChange={(value) => setForm((current) => ({ ...current, name: value }))} value={form.name} />
              <Field label="Phone" onChange={(value) => setForm((current) => ({ ...current, phone: value }))} type="tel" value={form.phone} />
            </div>
            <Field label="Email" onChange={(value) => setForm((current) => ({ ...current, email: value }))} type="email" value={form.email} />
          </CheckoutPanel>

          <CheckoutPanel title="Shipping Details">
            <Field label="Address" onChange={(value) => setForm((current) => ({ ...current, address: value }))} value={form.address} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="City" onChange={(value) => setForm((current) => ({ ...current, city: value }))} value={form.city} />
              <Field label="Province / Region" onChange={(value) => setForm((current) => ({ ...current, province: value }))} value={form.province} />
              <Field label="Order Notes" onChange={(value) => setForm((current) => ({ ...current, notes: value }))} required={false} value={form.notes} />
            </div>
          </CheckoutPanel>

          <CheckoutPanel title="Payment Method">
            <div className="grid gap-3 md:grid-cols-3">
              {activePaymentMethods.map((method) => (
                <button
                  className={cn(
                    'rounded-lg border p-4 text-left transition',
                    paymentMethod === method.label
                      ? 'border-burgundy bg-burgundy text-ivory'
                      : 'border-champagne/30 bg-marble text-brownroyal hover:border-oldgold',
                  )}
                  key={method.label}
                  onClick={() => setPaymentMethod(method.label)}
                  type="button"
                >
                  <method.icon className="mb-3 h-6 w-6" aria-hidden="true" />
                  <span className="block font-serif text-2xl font-semibold">{method.label}</span>
                  <span className="mt-1 block text-sm opacity-75">{method.description}</span>
                </button>
              ))}
            </div>
          </CheckoutPanel>

          <CheckoutPanel title="Coupon">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                className="h-12 flex-1 rounded-full border border-champagne/35 bg-marble px-4 text-brownroyal outline-none focus:border-burgundy"
                onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                placeholder="Enter coupon code"
                value={couponCode}
              />
              <Button onClick={() => void validateCoupon()} variant="outline">
                Apply Coupon
              </Button>
            </div>
            {couponMessage && <p className="text-sm font-semibold text-oldgold">{couponMessage}</p>}
          </CheckoutPanel>

          {orderError && (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
              role="alert"
            >
              {orderError}
            </p>
          )}

          <Button disabled={isSubmitting} size="lg" type="submit">
            <PackageCheck className="h-5 w-5" aria-hidden="true" />
            {isSubmitting ? 'Placing Order...' : 'Place Order'}
          </Button>
        </form>

        <aside className="h-fit rounded-lg border border-champagne/25 bg-ivory/90 p-6 shadow-xl shadow-brownroyal/10 lg:sticky lg:top-24">
          <h2 className="font-serif text-3xl font-semibold text-burgundy">Order Summary</h2>
          <p className="mt-1 text-sm font-semibold text-brownroyal/60">
            {enrichedItems.length} selected {enrichedItems.length === 1 ? 'item' : 'items'}
          </p>
          <div className="mt-5 space-y-4">
            {enrichedItems.map((item) => (
              <div className="flex justify-between gap-4 border-b border-champagne/20 pb-3" key={`${item!.productId}-${item!.size}`}>
                <div>
                  <p className="font-semibold text-brownroyal">{item!.product.name}</p>
                  <p className="text-sm text-brownroyal/55">
                    {item!.size} x {item!.quantity}
                  </p>
                </div>
                <p className="font-bold text-brownroyal">
                  {formatCurrency(item!.unitPrice * item!.quantity)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between text-lg font-extrabold text-burgundy">
            <span>Total</span>
            <span>{formatCurrency(orderTotal)}</span>
          </div>
          <div className="mt-4 space-y-2 text-sm text-brownroyal/70">
            <div className="flex justify-between"><span>Selected quantity</span><span>{selectedQuantity}</span></div>
            <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between"><span>Discount</span><span>{formatCurrency(discount)}</span></div>
            <div className="flex justify-between"><span>Shipping</span><span>{formatCurrency(effectiveShippingFee)}</span></div>
          </div>
        </aside>
      </section>
    </>
  )
}

function CheckoutPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-champagne/25 bg-ivory/88 p-6 shadow-sm">
      <h2 className="mb-5 font-serif text-3xl font-semibold text-burgundy">{title}</h2>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <label>
      <span className="mb-2 block text-sm font-bold text-brownroyal">{label}</span>
      <input
        className="h-12 w-full rounded-full border border-champagne/35 bg-marble px-4 text-brownroyal outline-none focus:border-burgundy"
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </label>
  )
}
