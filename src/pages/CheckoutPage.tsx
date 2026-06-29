import { CheckCircle2, CreditCard, Landmark, PackageCheck, Wallet } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/common/Button'
import { EmptyState } from '../components/common/EmptyState'
import { PageHeader } from '../components/common/PageHeader'
import { products } from '../data/products'
import { orderService } from '../services/orderService'
import { useCartStore } from '../store/cartStore'
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
  const { items, clearCart } = useCartStore()
  const [paymentMethod, setPaymentMethod] = useState<OrderPayload['paymentMethod']>('Cash on Delivery')
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    notes: '',
  })
  const [success, setSuccess] = useState<{ id: string; message: string } | null>(null)

  const enrichedItems = items
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const response = await orderService.createOrder({
      items,
      contact: {
        name: form.name,
        email: form.email,
        phone: form.phone,
      },
      shipping: {
        address: form.address,
        city: form.city,
        notes: form.notes,
      },
      paymentMethod,
    })
    setSuccess({ id: response.id, message: response.message })
    clearCart()
  }

  if (success) {
    return (
      <>
        <PageHeader
          description="Your mock checkout has completed successfully."
          eyebrow="Order Confirmed"
          title="A Royal Package Is Being Prepared"
        />
        <section className="container-lux py-12">
          <div className="marble-panel rounded-lg p-8 text-center">
            <CheckCircle2 className="mx-auto h-16 w-16 text-[#2f8f5b]" aria-hidden="true" />
            <h2 className="mt-5 font-serif text-4xl font-semibold text-burgundy">{success.message}</h2>
            <p className="mt-3 text-brownroyal/70">Mock order ID: {success.id}</p>
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
      <>
        <PageHeader
          description="Add perfumes to your cart before starting checkout."
          eyebrow="Checkout"
          title="Checkout UI"
        />
        <section className="container-lux py-12">
          <EmptyState
            description="There are no cart items to checkout right now."
            title="Your checkout is empty"
          />
        </section>
      </>
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
              <Field label="Order Notes" onChange={(value) => setForm((current) => ({ ...current, notes: value }))} required={false} value={form.notes} />
            </div>
          </CheckoutPanel>

          <CheckoutPanel title="Payment Method">
            <div className="grid gap-3 md:grid-cols-3">
              {paymentMethods.map((method) => (
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

          <Button size="lg" type="submit">
            <PackageCheck className="h-5 w-5" aria-hidden="true" />
            Place Mock Order
          </Button>
        </form>

        <aside className="h-fit rounded-lg border border-champagne/25 bg-ivory/90 p-6 shadow-xl shadow-brownroyal/10 lg:sticky lg:top-24">
          <h2 className="font-serif text-3xl font-semibold text-burgundy">Order Summary</h2>
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
            <span>{formatCurrency(subtotal)}</span>
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
