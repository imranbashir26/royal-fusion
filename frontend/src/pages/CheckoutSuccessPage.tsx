import { Link } from 'react-router-dom'
import { PageHeader } from '../components/common/PageHeader'
import { useCheckoutIntentStore } from '../store/checkoutIntentStore'
import { formatCurrency } from '../utils/format'

export function CheckoutSuccessPage() {
  const { receipt, completion } = useCheckoutIntentStore()
  // Historical receipts are display-only. Mounting this route never changes a cart.
  if (!receipt || !completion) return <section className="container-lux py-16" role="status"><h1 className="font-serif text-3xl">No order confirmation is available</h1><Link to="/checkout">Return to checkout</Link></section>
  return <>
    <PageHeader eyebrow="Order received" title={`Thank you — ${receipt.orderNumber}`} description="Your order has been received. Keep your order number for reference." />
    <section className="container-lux py-12">
      <dl className="mx-auto grid max-w-xl gap-4 rounded-lg bg-ivory p-8">
        <div><dt>Order number</dt><dd className="font-bold">{receipt.orderNumber}</dd></div>
        <div><dt>Order status</dt><dd>{receipt.status}</dd></div>
        <div><dt>Payment status</dt><dd>{receipt.paymentStatus}</dd></div>
        <div><dt>Payment method</dt><dd>{receipt.paymentMethod}</dd></div>
        {(['subtotal', 'discount', 'shippingFee', 'total'] as const).map((key) => <div className="flex justify-between" key={key}><dt>{({ subtotal: 'Subtotal', discount: 'Discount', shippingFee: 'Shipping', total: 'Total' })[key]}</dt><dd>{formatCurrency(receipt[key])}</dd></div>)}
        <div><dt>Currency</dt><dd>{receipt.currency}</dd></div>
        <Link to="/shop" className="text-burgundy underline">Continue shopping</Link>
      </dl>
    </section>
  </>
}
