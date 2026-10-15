import type {AdminSaleSnapshot} from '../services/saleSchedule'
import {adminSaleState} from '../services/saleSchedule'
import {formatCheckoutCurrency as formatCurrency} from '../utils/checkoutMoney'

export function SaleScheduleFields({sale, label}: {sale: AdminSaleSnapshot; label: string}) {
  return <fieldset className="space-y-3 rounded-lg border border-champagne/35 bg-ivory p-4">
    <legend className="px-2 font-semibold">{label} — saved pricing</legend>
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt>Regular price</dt><dd>{sale.regularPrice == null ? 'Not configured' : formatCurrency(sale.regularPrice)}</dd></div>
      <div><dt>Configured sale price</dt><dd>{sale.salePrice == null ? 'None' : formatCurrency(sale.salePrice)}</dd></div>
      <div><dt>Effective price at database snapshot</dt><dd>{sale.effectivePrice == null ? 'Unavailable until saved or refreshed' : formatCurrency(sale.effectivePrice)}</dd></div>
      <div><dt>Sale state at database snapshot</dt><dd>{adminSaleState(sale)}</dd></div>
    </dl>
    {sale.pricingAt && <p className="text-xs">Database pricing at {sale.pricingAt}. Reopen this editor to refresh pricing.</p>}
    <p className="text-sm">Scheduling unavailable. Scheduled-sale submissions remain disabled. Existing immediate-sale editing is available above.</p>
    <fieldset disabled className="grid gap-3 sm:grid-cols-2">
      <legend className="sr-only">Schedule preview — disabled</legend>
      <label>Sale start (ISO timestamp with UTC offset)<input type="text" readOnly className="mt-1 w-full rounded border border-champagne/40 px-3 py-2" value={sale.saleStartsAt ?? ''} placeholder="No start — immediate" /></label>
      <label>Sale end (ISO timestamp with UTC offset)<input type="text" readOnly className="mt-1 w-full rounded border border-champagne/40 px-3 py-2" value={sale.saleEndsAt ?? ''} placeholder="No end — indefinite" /></label>
    </fieldset>
    <p className="text-xs">Z means UTC; +05:00 means UTC+05:00. Offset and microsecond values are shown exactly as received. Untouched schedule bounds are omitted when saving; clearing a sale also clears its schedule.</p>
  </fieldset>
}
