import { PolicyPageLayout } from '../components/layout/PolicyPageLayout'

export function ShippingPolicyPage() {
  return (
    <PolicyPageLayout
      activePath="/shipping-policy"
      title="Shipping & Delivery Policy"
      description="Nationwide delivery coverage across Pakistan, clear shipping rates, and order tracking details."
    >
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          1. Nationwide Delivery Coverage
        </h2>
        <p>
          Royal Fusion proudly delivers our luxury perfumes, concentrated attars, and discovery packs all over Pakistan,
          including all provinces and territories:
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 text-sm font-medium text-burgundy">
          <span className="rounded-md border border-champagne/30 bg-marble/40 p-2 text-center">Punjab</span>
          <span className="rounded-md border border-champagne/30 bg-marble/40 p-2 text-center">Sindh</span>
          <span className="rounded-md border border-champagne/30 bg-marble/40 p-2 text-center">Khyber Pakhtunkhwa</span>
          <span className="rounded-md border border-champagne/30 bg-marble/40 p-2 text-center">Balochistan</span>
          <span className="rounded-md border border-champagne/30 bg-marble/40 p-2 text-center">Islamabad Capital</span>
          <span className="rounded-md border border-champagne/30 bg-marble/40 p-2 text-center">Azad Kashmir &amp; GB</span>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          2. Shipping Rates and Free Delivery
        </h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-burgundy">Standard Nationwide Delivery:</strong> A flat shipping charge of{' '}
            <strong className="text-burgundy">PKR 200</strong> applies to standard delivery orders nationwide.
          </li>
          <li>
            <strong className="text-burgundy">Free Delivery:</strong> Orders strictly{' '}
            <strong className="text-burgundy">over PKR 5,000</strong> qualify for free delivery across Pakistan.
          </li>
          <li>
            <strong className="text-burgundy">Upfront Transparent Pricing:</strong> The exact calculated order subtotal,
            applicable shipping fee, and any active promotional or coupon discounts are clearly presented for your confirmation
            on the checkout screen before you submit your order.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          3. Estimated Delivery Timelines
        </h2>
        <p>
          Deliveries typically arrive within <strong className="text-burgundy">3–4 days</strong> following order confirmation.
        </p>
        <p>
          Please note that delivery timelines are careful estimates and not guaranteed deadlines. Actual delivery times may vary
          slightly due to public holidays, weather disturbances, road blockages, or courier logistics schedules in remote
          destinations.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          4. Courier Partners and Shipment Tracking
        </h2>
        <p>
          We dispatch parcels using reputable national courier services (such as TCS, Leopards, Trax, or Call Courier).
        </p>
        <p>
          Once your package is dispatched, an official courier tracking number and the name of the courier company will be
          recorded on your order. Registered customers can view their courier tracking information at any time within their
          customer account dashboard under <strong className="text-burgundy">My Orders</strong>. Guest customers may request
          immediate tracking updates by contacting our concierge on WhatsApp.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          5. Customer Delivery Address Responsibilities
        </h2>
        <p>
          To ensure smooth and timely delivery, customers must provide complete and accurate shipping information:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>Full physical street address, building or house number, sector/area, city, and province.</li>
          <li>An active and reachable Pakistani mobile telephone number. Courier delivery riders will telephone the recipient prior to physical arrival.</li>
          <li>If an order cannot be delivered due to an incorrect or incomplete address, or if the recipient is repeatedly unreachable by phone, the parcel may be returned to our facility. Re-dispatch charges may apply.</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          6. Delivery Inquiries and Support
        </h2>
        <p>
          If your package has not arrived within the estimated delivery period or if you have any questions regarding your
          shipment, please reach out to our concierge team:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>WhatsApp: <a href="https://wa.me/923278647667" target="_blank" rel="noopener noreferrer" className="font-medium underline hover:text-burgundy">+92 3278647667</a></li>
          <li>Email: <a href="mailto:billing@royal-fusion.com" className="font-medium underline hover:text-burgundy">billing@royal-fusion.com</a></li>
        </ul>
      </section>
    </PolicyPageLayout>
  )
}
