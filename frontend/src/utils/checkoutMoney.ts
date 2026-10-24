// Checkout values are already normalized by the authoritative pricing service.
// Format them directly; keep the storefront's whole-rupee convention separate.
const checkoutCurrency = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const formatCheckoutCurrency = (value: number) => checkoutCurrency.format(value)
