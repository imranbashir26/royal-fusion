import type {AdminSaleSnapshot} from '../services/saleSchedule'
import {adminSaleState} from '../services/saleSchedule'
import {formatCheckoutCurrency as formatCurrency} from '../utils/checkoutMoney'

export function SaleScheduleFields({sale, label, enabled = false, edited = {}, onChange}: {
  sale: AdminSaleSnapshot; label: string; enabled?: boolean; edited?: AdminSaleSnapshot
  onChange?: (patch: AdminSaleSnapshot) => void
}) {
  const current = {...sale, ...edited}, writable = enabled && Boolean(onChange)
  return <fieldset className="space-y-3 rounded-lg border border-champagne/35 bg-ivory p-4">
    <legend className="px-2 font-semibold">{label} — saved pricing</legend>
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt>Regular price</dt><dd>{sale.regularPrice == null ? 'Not configured' : formatCurrency(sale.regularPrice)}</dd></div>
      <div><dt>Configured sale price</dt><dd>{sale.salePrice == null ? 'None' : formatCurrency(sale.salePrice)}</dd></div>
      <div><dt>Effective price at database snapshot</dt><dd>{sale.effectivePrice == null ? 'Unavailable until saved or refreshed' : formatCurrency(sale.effectivePrice)}</dd></div>
      <div><dt>Sale state at database snapshot</dt><dd>{adminSaleState(sale)}</dd></div>
    </dl>
    {sale.pricingAt && <p className="text-xs">Database pricing at {sale.pricingAt}. Reopen this editor to refresh pricing.</p>}
    <p className="text-sm">{writable ? 'Scheduled-sale administration is available. Save the form to apply these variant-owned changes.' : 'Scheduling unavailable. Scheduled-sale submissions remain disabled. Existing immediate-sale editing is available above.'}</p>
    <fieldset disabled={!writable} className="grid gap-3 sm:grid-cols-2">
      <legend className="sr-only">Sale schedule</legend>
      {writable && <label>Scheduled sale price (PKR fixed amount)<input type="number" step="0.01" min="0.01" value={current.salePrice ?? ''} onChange={e => onChange?.({salePrice:e.target.value === '' ? null : Number(e.target.value)})} /></label>}
      <label>Sale start (ISO timestamp with UTC offset)<input type="text" readOnly={!writable} onChange={e => onChange?.({saleStartsAt:e.target.value || null})} className="mt-1 w-full rounded border border-champagne/40 px-3 py-2" value={current.saleStartsAt ?? ''} placeholder="No start — immediate" /></label>
      <label>Sale end (ISO timestamp with UTC offset)<input type="text" readOnly={!writable} onChange={e => onChange?.({saleEndsAt:e.target.value || null})} className="mt-1 w-full rounded border border-champagne/40 px-3 py-2" value={current.saleEndsAt ?? ''} placeholder="No end — indefinite" /></label>
      {writable && <button type="button" onClick={() => onChange?.({salePrice:null,saleStartsAt:null,saleEndsAt:null})}>Clear sale and schedule</button>}
    </fieldset>
    <p className="text-xs">Asia/Karachi uses UTC+05:00 (example: 2027-01-01T09:00:00+05:00). Z means UTC. Offset and microsecond values are preserved exactly. Untouched schedule bounds are omitted when saving; clearing a sale also clears its schedule.</p>
  </fieldset>
}
