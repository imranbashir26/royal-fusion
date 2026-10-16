import type { CheckoutPricingOutcome } from '../../types'
import { formatCheckoutCurrency } from '../../utils/checkoutMoney'

export function CheckoutPricingDetails({outcome}:{outcome?:CheckoutPricingOutcome|null}){
 if(!outcome)return null
 const message=outcome.couponOutcome==='applied'?'Coupon applied to regular prices.':outcome.couponOutcome==='tie'?'Totals are equal; sale pricing retained and coupon not used.':outcome.couponOutcome==='sale_better'?'Existing sale prices provide a lower merchandise total; coupon not used.':null
 return <div className="my-4 space-y-2" aria-label="Pricing outcome">
  {message&&<p role="status">{message}</p>}
  {outcome.requestedCouponCode&&<p>Requested coupon: {outcome.requestedCouponCode}</p>}
  {outcome.appliedCouponCode&&<p>Applied coupon: {outcome.appliedCouponCode}</p>}
  <p>Merchandise total: {formatCheckoutCurrency(outcome.merchandiseTotal)}</p>
 </div>
}
export function SelectedCheckoutCharges({lines,label,unitLabel='Quoted unit price'}:{unitLabel?:string;lines:{id?:string;name?:string;quantity:number;unitPrice:number;lineTotal:number}[];label:string}){
 return <ul aria-label={label} className="my-4 space-y-3">{lines.map((line,index)=><li key={line.id??index}>
  <p>{line.name??'Item '+(index+1)} × {line.quantity}</p>
  <p>{unitLabel}: {formatCheckoutCurrency(line.unitPrice)}</p><p>Line total: {formatCheckoutCurrency(line.lineTotal)}</p>
 </li>)}</ul>
}
