import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('App.tsx registers all four policy pages and legacy redirects', () => {
  const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /import\('\.\/pages\/PrivacyPolicyPage'\)/)
  assert.match(app, /import\('\.\/pages\/TermsPage'\)/)
  assert.match(app, /import\('\.\/pages\/ShippingPolicyPage'\)/)
  assert.match(app, /import\('\.\/pages\/ReturnsRefundsPage'\)/)

  assert.match(app, /<Route path="\/privacy-policy" element=\{publicPage\(PrivacyPolicyPage\)\} \/>/)
  assert.match(app, /<Route path="\/terms-and-conditions" element=\{publicPage\(TermsPage\)\} \/>/)
  assert.match(app, /<Route path="\/shipping-policy" element=\{publicPage\(ShippingPolicyPage\)\} \/>/)
  assert.match(app, /<Route path="\/returns-refunds" element=\{publicPage\(ReturnsRefundsPage\)\} \/>/)

  assert.match(app, /<Route path="\/terms" element=\{<Navigate replace to="\/terms-and-conditions" \/>\} \/>/)
  assert.match(app, /<Route path="\/terms-of-service" element=\{<Navigate replace to="\/terms-and-conditions" \/>\} \/>/)
  assert.match(app, /<Route path="\/return-policy" element=\{<Navigate replace to="\/returns-refunds" \/>\} \/>/)
})

test('PrivacyPolicyPage contains verified technical facts and approved contacts without developer placeholders', () => {
  const content = readFileSync(path.join(root, 'src/pages/PrivacyPolicyPage.tsx'), 'utf8')
  assert.match(content, /Shop #544, Saddar Bazar, Attock Cantt, Pakistan/)
  assert.match(content, /billing@royal-fusion\.com/)
  assert.match(content, /\+92 3278647667/)
  assert.match(content, /__Host-rf-at/)
  assert.match(content, /__Host-rf-rt/)
  assert.match(content, /__Host-rf-sid/)
  assert.match(content, /__Host-rf-csrf/)
  assert.match(content, /royal-fusion-cart/)
  assert.match(content, /royal-fusion-wishlist/)
  assert.match(content, /TCS, Leopards, Trax/)
  assert.doesNotMatch(content, /\[OWNER APPROVAL REQUIRED\]/)
  assert.doesNotMatch(content, /\[LEGAL REVIEW REQUIRED\]/)
  assert.doesNotMatch(content, /TODO/i)
})

test('TermsPage contains approved business terms, PKR pricing, 2-minute quote validity, and cancellation rules', () => {
  const content = readFileSync(path.join(root, 'src/pages/TermsPage.tsx'), 'utf8')
  assert.match(content, /Pakistani Rupees \(PKR \/ Rs\)/)
  assert.match(content, /120 seconds \(2 minutes\)/)
  assert.match(content, /Cash on Delivery \(COD\)/)
  assert.match(content, /Direct Bank Wire Transfer/)
  assert.match(content, /order is marked as (&quot;|")Shipped(&quot;|")/)
  assert.match(content, /Shop #544, Saddar Bazar, Attock Cantt, Pakistan/)
  assert.doesNotMatch(content, /\[OWNER APPROVAL REQUIRED\]/)
  assert.doesNotMatch(content, /\[LEGAL REVIEW REQUIRED\]/)
})

test('ShippingPolicyPage contains PKR 200 fee, strictly over PKR 5,000 free delivery, 3–4 days estimate, and upfront disclosure', () => {
  const content = readFileSync(path.join(root, 'src/pages/ShippingPolicyPage.tsx'), 'utf8')
  assert.match(content, /PKR 200/)
  assert.match(content, /over PKR 5,000/)
  assert.match(content, /3–4 days/)
  assert.match(content, /Upfront Transparent Pricing/)
  assert.match(content, /Punjab/)
  assert.match(content, /Sindh/)
  assert.match(content, /Khyber Pakhtunkhwa/)
  assert.match(content, /Balochistan/)
  assert.doesNotMatch(content, /PKR 5,000 or above/)
  assert.doesNotMatch(content, /\[OWNER APPROVAL REQUIRED\]/)
  assert.doesNotMatch(content, /\[LEGAL REVIEW REQUIRED\]/)
})

test('ReturnsRefundsPage contains 15-day window, exact 97–98% wording, legacy terms, and damaged goods protections', () => {
  const content = readFileSync(path.join(root, 'src/pages/ReturnsRefundsPage.tsx'), 'utf8')
  assert.match(content, /15 days/)
  assert.match(content, /97–98% perfume remaining/)
  assert.match(content, /not eligible for ordinary satisfaction returns or exchanges/)
  assert.match(content, /Royal Fusion bears the applicable return shipping charges/)
  assert.match(content, /Original outbound delivery charges are\s+non-refundable/)
  assert.match(content, /pays the\s+applicable delivery charges/)
  assert.match(content, /above PKR 10,000.*are exchange-only rather than refundable/)
  assert.match(content, /Bank Wire Transfer/)
  assert.match(content, /one week/)
  assert.doesNotMatch(content, /7-day/)
  assert.doesNotMatch(content, /90%/)
  assert.doesNotMatch(content, /\[OWNER APPROVAL REQUIRED\]/)
  assert.doesNotMatch(content, /\[LEGAL REVIEW REQUIRED\]/)
})

test('Footer contains working navigation links to all four legal policies', () => {
  const footer = readFileSync(path.join(root, 'src/components/layout/Footer.tsx'), 'utf8')
  assert.match(footer, /\{ label: 'Shipping Policy', to: '\/shipping-policy' \}/)
  assert.match(footer, /\{ label: 'Returns & Exchanges', to: '\/returns-refunds' \}/)
  assert.match(footer, /\{ label: 'Privacy Policy', to: '\/privacy-policy' \}/)
  assert.match(footer, /\{ label: 'Terms & Conditions', to: '\/terms-and-conditions' \}/)
})

test('CheckoutPage provides links to Terms, Privacy, Shipping, and Returns before placing order', () => {
  const checkout = readFileSync(path.join(root, 'src/pages/CheckoutPage.tsx'), 'utf8')
  assert.match(checkout, /to="\/terms-and-conditions"/)
  assert.match(checkout, /to="\/privacy-policy"/)
  assert.match(checkout, /to="\/shipping-policy"/)
  assert.match(checkout, /to="\/returns-refunds"/)
  assert.match(checkout, /I confirm the quoted total of/)
  assert.match(checkout, /Place Order/)
})

test('AccountModal provides Terms and Privacy links in signup mode', () => {
  const modal = readFileSync(path.join(root, 'src/components/account/AccountModal.tsx'), 'utf8')
  assert.match(modal, /to="\/terms-and-conditions"/)
  assert.match(modal, /to="\/privacy-policy"/)
  assert.match(modal, /mode === 'signup'/)
})

test('Storefront FAQs and About page reflect 15-day policy and no obsolete 7-day statements', () => {
  const faqs = readFileSync(path.join(root, 'src/data/faqs.ts'), 'utf8')
  const about = readFileSync(path.join(root, 'src/pages/AboutPage.tsx'), 'utf8')

  assert.match(faqs, /15-day return and exchange policy/)
  assert.match(faqs, /97–98% perfume remaining/)
  assert.doesNotMatch(faqs, /7-day return policy/)

  assert.match(about, /15-day returns and exchanges/)
  assert.doesNotMatch(about, /7-day returns/)
})

test('storefrontSeo staticSeoPaths includes all four policy paths and provides default metadata', () => {
  const seoContent = readFileSync(path.join(root, 'src/services/storefrontSeo.ts'), 'utf8')
  assert.match(seoContent, /'\/privacy-policy'/)
  assert.match(seoContent, /'\/terms-and-conditions'/)
  assert.match(seoContent, /'\/shipping-policy'/)
  assert.match(seoContent, /'\/returns-refunds'/)
  assert.match(seoContent, /title:\s*'Privacy Policy \| Royal Fusion'/)
  assert.match(seoContent, /title:\s*'Terms and Conditions \| Royal Fusion'/)
  assert.match(seoContent, /title:\s*'Shipping & Delivery Policy \| Royal Fusion'/)
  assert.match(seoContent, /title:\s*'Returns, Refunds & Exchanges \| Royal Fusion'/)
  assert.match(seoContent, /policyMeta\?\.title/)
  assert.match(seoContent, /policyMeta\?\.description/)
})
