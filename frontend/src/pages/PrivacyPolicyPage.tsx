import { PolicyPageLayout } from '../components/layout/PolicyPageLayout'

export function PrivacyPolicyPage() {
  return (
    <PolicyPageLayout
      activePath="/privacy-policy"
      title="Privacy Policy"
      description="How Royal Fusion collects, uses, and protects your personal information and transaction records."
    >
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          1. Overview and Business Identity
        </h2>
        <p>
          Royal Fusion is committed to safeguarding the privacy and personal data of our customers and visitors.
          This Privacy Policy outlines the specific categories of information we collect, the reasons for processing,
          the storage mechanisms employed, and your rights concerning your personal information when you access or make
          a purchase on royal-fusion.com.
        </p>
        <p>
          Our operations and customer concierge are located at:
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
          2. Personal Information We Collect
        </h2>
        <p>
          We collect only the information strictly required to authenticate user sessions, calculate checkout quotations,
          fulfill physical deliveries, and maintain accurate commercial and tax records:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-burgundy">Account Credentials and Profiles:</strong> When you register an account,
            we record your full name, email address, and optional phone number. Account authentication is handled through
            a secure identity gateway; raw passwords and sensitive security credentials are encrypted and never stored in
            plain text by our application servers.
          </li>
          <li>
            <strong className="text-burgundy">Order and Delivery Information:</strong> When you place an order (either as a
            registered customer or through guest checkout), we collect the recipient&apos;s full name, delivery address, city,
            province or administrative territory, contact phone number, and any special delivery instructions.
          </li>
          <li>
            <strong className="text-burgundy">Payment and Transaction Records:</strong> We record the chosen payment method
            (Cash on Delivery or Bank Wire Transfer), payment status (e.g., Unpaid, Pending, Paid), transaction totals in
            Pakistani Rupees (PKR), and customer-provided bank wire reference codes. We do not collect or store credit card,
            debit card, CVV, or online banking PIN credentials.
          </li>
          <li>
            <strong className="text-burgundy">Customer Concierge Inquiries:</strong> If you contact us via email, WhatsApp,
            or our website contact form, we retain records of the correspondence to assist with your order inquiries.
          </li>
          <li>
            <strong className="text-burgundy">Newsletter Subscriptions:</strong> If you voluntarily subscribe to our fragrance
            journal or updates, we retain your email address until you choose to unsubscribe.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          3. Browser Cookies and Local Storage
        </h2>
        <p>
          Royal Fusion utilizes functional browser storage strictly for system security, anti-forgery protection, and
          shopping convenience:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-burgundy">Security and Authentication Cookies:</strong> In production environments,
            we issue hardened, encrypted, HTTP-only cookies with secure transport flags prefixed with <code className="rounded bg-champagne/20 px-1 py-0.5 text-xs text-burgundy">__Host-rf-</code> (including <code className="rounded bg-champagne/20 px-1 py-0.5 text-xs text-burgundy">__Host-rf-sid</code> for session handles, <code className="rounded bg-champagne/20 px-1 py-0.5 text-xs text-burgundy">__Host-rf-at</code> for access tokens, <code className="rounded bg-champagne/20 px-1 py-0.5 text-xs text-burgundy">__Host-rf-rt</code> for refresh tokens, and <code className="rounded bg-champagne/20 px-1 py-0.5 text-xs text-burgundy">__Host-rf-csrf</code> for anti-forgery CSRF protection). These cookies authenticate legitimate requests
            and protect user accounts from unauthorized cross-site manipulation.
          </li>
          <li>
            <strong className="text-burgundy">Local Storage:</strong> We use client-side local storage exclusively for your
            convenience: <code className="rounded bg-champagne/20 px-1 py-0.5 text-xs text-burgundy">royal-fusion-cart</code> preserves
            your chosen fragrance bottles, tester vials, and custom pack configurations between page reloads, and{' '}
            <code className="rounded bg-champagne/20 px-1 py-0.5 text-xs text-burgundy">royal-fusion-wishlist</code> stores your
            bookmarked perfumes.
          </li>
          <li>
            <strong className="text-burgundy">Session Storage:</strong> Temporary session markers preserve introductory brand
            presentation preferences and ephemeral checkout recovery keys during an active browser session.
          </li>
          <li>
            <strong className="text-burgundy">Zero Advertising Trackers:</strong> Royal Fusion does not install or deploy
            third-party advertising tracking pixels, behavioral surveillance scripts, or invasive session recording software
            (such as Google Analytics, Meta/Facebook Pixel, TikTok Pixel, Hotjar, or Clarity).
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          4. How Your Information Is Used and Shared
        </h2>
        <p>
          We do not sell, rent, or trade your personal data. We disclose personal information only to trusted service
          providers strictly required for order fulfillment:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong className="text-burgundy">Courier Logistics Partners:</strong> For order fulfillment, the recipient&apos;s
            name, physical shipping address, and contact phone number are provided to trusted Pakistani courier services
            (such as TCS, Leopards, Trax, or Call Courier) to coordinate physical delivery and rider handover.
          </li>
          <li>
            <strong className="text-burgundy">Cloud Hosting and Database Infrastructure:</strong> Our transactional databases
            and product media assets are maintained with reputable cloud infrastructure providers under strict confidentiality
            and security standards.
          </li>
          <li>
            <strong className="text-burgundy">Legal Compliance:</strong> We may disclose information if required to comply
            with applicable laws of the Islamic Republic of Pakistan or in response to lawful requests by competent judicial
            authorities.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-burgundy md:text-3xl">
          5. Data Retention and Customer Rights
        </h2>
        <p>
          Completed order records and commercial invoices are retained indefinitely to satisfy financial accounting, audit,
          and statutory consumer warranty obligations.
        </p>
        <p>
          You have the right to access and review your personal profile and historical order receipts at any time by signing
          in to your customer account. If you wish to update your profile details, correct information, or request account
          deactivation or deletion, please contact our concierge at{' '}
          <a href="mailto:billing@royal-fusion.com" className="font-medium underline hover:text-burgundy">
            billing@royal-fusion.com
          </a>.
        </p>
      </section>
    </PolicyPageLayout>
  )
}
