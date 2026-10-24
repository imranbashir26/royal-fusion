import { PolicyPageLayout } from '../components/layout/PolicyPageLayout'

export function ReturnsRefundsPage() {
  return (
    <PolicyPageLayout
      activePath="/returns-refunds"
      title="Returns, Refunds & Exchanges"
      description="Our 15-day return and exchange policy for luxury fragrances, eligibility standards, and procedures."
    >
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          1. 15-Day Return and Exchange Window
        </h2>
        <p>
          At Royal Fusion, we want you to experience our luxury fragrance creations with confidence. If you are not completely
          satisfied with an eligible fragrance, you may request a return or exchange within{' '}
          <strong className="text-burgundy">15 days</strong> after physical delivery by the courier.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          2. Product Condition and Eligibility Standards
        </h2>
        <p>
          To qualify for an ordinary customer-satisfaction return or exchange:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-burgundy">Volume Remaining:</strong> The bottle must have{' '}
            <strong className="text-burgundy">97–98% perfume remaining</strong>. This condition allows for a minimal, cautious
            test spray (1–2 sprays) while ensuring the fragrance has not been substantially used.
          </li>
          <li>
            <strong className="text-burgundy">Original Packaging:</strong> The product must be returned in its original,
            undamaged presentation box with caps, protective collars, and luxury inserts clean and intact.
          </li>
          <li>
            <strong className="text-burgundy">Integrity and Cleanliness:</strong> Bottles that are scratched, defaced,
            tampered with, or have broken atomizers cannot be accepted for ordinary returns.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          3. Tester Boxes and Discovery Packs
        </h2>
        <p>
          Standalone tester boxes, fragrance samples, fixed Discovery Packs, and configurable Build-Your-Own Discovery Packs
          are curated specifically for exploratory sampling. Consequently, they are{' '}
          <strong className="text-burgundy">not eligible for ordinary satisfaction returns or exchanges</strong>.
        </p>
        <p>
          This exclusion applies solely to ordinary changes of mind. Any Discovery Pack or sample vial that arrives damaged,
          leaking, or defective remains fully protected under our damaged goods policy below.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          4. Damaged, Leaking, Defective, or Incorrect Goods
        </h2>
        <p>
          If your package arrives damaged during courier transit, shows bottle leakage, has a defective spray mechanism,
          or contains an incorrectly supplied fragrance:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Please notify our concierge within <strong className="text-burgundy">48 hours</strong> of delivery with clear
            photographs or video of the parcel and defective item.
          </li>
          <li>
            Royal Fusion will promptly provide an appropriate replacement, exchange, or full refund subject to applicable consumer protection laws.
          </li>
          <li>
            <strong className="text-burgundy">Royal Fusion bears the applicable return shipping charges</strong> for damaged,
            defective, or incorrectly delivered items.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          5. Shipping Charges and Value Restrictions for Ordinary Returns
        </h2>
        <p>
          For voluntary, customer-satisfaction returns and exchanges:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-burgundy">Return Delivery:</strong> The customer pays the applicable courier charges to
            safely return the parcel to our facility.
          </li>
          <li>
            <strong className="text-burgundy">Original Delivery Charges:</strong> Original outbound delivery charges are
            non-refundable for ordinary returns or exchanges.
          </li>
          <li>
            <strong className="text-burgundy">Exchange Delivery:</strong> For ordinary exchanges, the customer pays the
            applicable delivery charges for dispatching the replacement fragrance.
          </li>
          <li>
            <strong className="text-burgundy">High-Value Orders:</strong> For ordinary returns, orders strictly{' '}
            <strong className="text-burgundy">above PKR 10,000</strong> are exchange-only rather than refundable.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          6. Refund Method and Processing Timelines
        </h2>
        <p>
          All approved refunds are issued exclusively via direct <strong className="text-burgundy">Bank Wire Transfer</strong> to
          the customer&apos;s designated Pakistani bank account (requiring Bank Name, Account Title, and IBAN). Cash refunds via courier
          are not supported.
        </p>
        <p>
          Refunds are processed approximately <strong className="text-burgundy">one week</strong> after receiving the returned
          parcel at our facility and completing product condition and eligibility review.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          7. How to Request a Return or Exchange
        </h2>
        <p>
          To request a return or exchange, contact our concierge directly:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>WhatsApp: <a href="https://wa.me/923278647667" target="_blank" rel="noopener noreferrer" className="font-medium underline hover:text-burgundy">+92 3278647667</a></li>
          <li>Email: <a href="mailto:billing@royal-fusion.com" className="font-medium underline hover:text-burgundy">billing@royal-fusion.com</a></li>
        </ul>
        <p className="mt-2 text-sm">
          Please provide your <strong className="text-burgundy">Order Number</strong>, item name, and reason for return. Our
          team will confirm return eligibility and provide the authorized return shipping address.
        </p>
      </section>
    </PolicyPageLayout>
  )
}
