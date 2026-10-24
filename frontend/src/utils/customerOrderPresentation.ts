/** Display the recorded currency and amount; historical receipts never consult the catalog. */
export function formatCustomerOrderCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount)
}
