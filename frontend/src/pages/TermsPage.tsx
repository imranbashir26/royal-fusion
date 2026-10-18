import { Link } from 'react-router-dom'
import { PolicyPageLayout } from '../components/layout/PolicyPageLayout'

export function TermsPage() {
  return (
    <PolicyPageLayout
      activePath="/terms-and-conditions"
      title="Terms and Conditions"
      description="The official terms and commercial conditions governing purchases and website use at Royal Fusion."
    >
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          1. Commercial Terms and Scope
        </h2>
        <p>
          These Terms and Conditions (&quot;Terms&quot;) govern your access to royal-fusion.com and all orders submitted to
          Royal Fusion. By browsing our website, creating an account, or placing an order, you agree to comply with and be
          bound by these Terms.
        </p>
        <p>
          Royal Fusion operates from:
        </p>
        <div className="rounded-lg border border-champagne/30 bg-marble/50 p-4 text-sm space-y-1">
          <p className="font-semibold text-burgundy">Royal Fusion</p>
          <p>Shop #544, Saddar Bazar, Attock Cantt, Pakistan</p>
          <p>Email: <a href="mailto:billing@royal-fusion.com" className="underline hover:text-burgundy">billing@royal-fusion.com</a></p>
          <p>WhatsApp: <a href="https://wa.me/923278647667" target="_blank" rel="noopener noreferrer" className="underline hover:text-burgundy">+92 3278647667</a></p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          2. Eligibility and Customer Accounts
        </h2>
        <p>
          By placing an order, you represent that you are at least 18 years of age, or that you are using this website under
          the supervision and consent of a parent or legal guardian.
        </p>
        <p>
          If you register an account, you are responsible for maintaining the confidentiality of your login credentials and
          for restricting unauthorized access to your device. You may also purchase as a guest; guest orders can be securely
          claimed into a registered customer profile using a secure order claim token.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          3. Products, Fragrance Longevity, and Availability
        </h2>
        <p>
          Royal Fusion specializes in luxury perfume impressions, traditional concentrated attars, and discovery tester packs.
          Because olfactory experiences are personal, fragrance longevity, sillage, and scent evolution naturally vary depending
          upon individual skin chemistry, ambient humidity, temperature, and application surface.
        </p>
        <p>
          All product listings are subject to physical stock availability. In the rare event that an item becomes unavailable
          after order placement, our concierge will notify you promptly to offer a suitable replacement or cancellation.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          4. Pricing and Checkout Quotation Validity
        </h2>
        <p>
          All product prices, promotional discounts, shipping fees, and order totals are calculated and payable exclusively
          in <strong className="text-burgundy">Pakistani Rupees (PKR / Rs)</strong>.
        </p>
        <p>
          To safeguard against price changes, promotional expirations, and stock slippage while shopping, our checkout
          utilizes a cryptographic quote engine:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Every checkout quotation is valid for exactly <strong className="text-burgundy">120 seconds (2 minutes)</strong>.
          </li>
          <li>
            If catalog prices, coupon discounts, or shipping charges are updated while you are completing checkout, the stale
            quote is automatically rejected to ensure complete financial transparency, requiring you to confirm the updated total.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          5. Order Placement and Formation of Contract
        </h2>
        <p>
          Submitting an order through our checkout constitutes an offer to purchase the selected items. Upon submission, an order
          record is logged in &quot;Pending&quot; status, and a digital receipt summary is generated.
        </p>
        <p>
          A legally binding contract of sale is formally concluded only when Royal Fusion confirms your order and physically
          dispatches the package with an assigned courier tracking number. Royal Fusion reserves the right to decline or cancel
          an order prior to dispatch in the event of an obvious pricing error, suspected fraud, or unverified recipient details.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          6. Supported Payment Methods
        </h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-burgundy">Cash on Delivery (COD):</strong> The exact quoted total amount must be paid in
            cash to the courier delivery agent upon physical delivery of the parcel. Repeated refusal of confirmed COD deliveries
            without valid cause may result in suspension of ordering privileges.
          </li>
          <li>
            <strong className="text-burgundy">Direct Bank Wire Transfer:</strong> When selecting Bank Transfer, the quoted order
            amount must be transferred directly to our designated Pakistani bank account. Orders remain in &quot;Pending&quot; status
            until payment is verified by our administrative team.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          7. Promotions and Coupon Codes
        </h2>
        <p>
          Coupon codes and promotional sales are subject to published validity dates, minimum spend requirements, and applicable
          product categories. Coupons cannot be redeemed for cash, transferred, or applied retroactively to completed orders.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          8. Order Cancellation Requests
        </h2>
        <p>
          The website does not feature an automated customer-facing cancellation button. If you need to cancel an order, you must
          contact our concierge immediately via WhatsApp (<a href="https://wa.me/923278647667" target="_blank" rel="noopener noreferrer" className="underline hover:text-burgundy">+92 3278647667</a>)
          or email (<a href="mailto:billing@royal-fusion.com" className="underline hover:text-burgundy">billing@royal-fusion.com</a>) quoting
          your Order Number.
        </p>
        <p>
          Cancellation requests can only be accommodated before your parcel has been processed and handed over to the courier
          (while in &quot;Pending&quot; or &quot;Processing&quot; status). Once an order is marked as &quot;Shipped&quot;, it cannot be cancelled
          in transit and must be handled under our <Link to="/returns-refunds" className="font-medium underline hover:text-burgundy">Returns & Exchanges Policy</Link>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          9. Governing Law
        </h2>
        <p>
          These Terms are governed by and construed in accordance with the laws of the Islamic Republic of Pakistan, without
          prejudice to your statutory consumer rights under applicable provincial consumer protection laws.
        </p>
      </section>
    </PolicyPageLayout>
  )
}
