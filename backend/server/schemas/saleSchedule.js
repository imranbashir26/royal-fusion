import {z} from 'zod'

// Match Release 009: explicit seconds and offset, at most PostgreSQL's six fractional digits.
export const saleTimestamp=z.iso.datetime({offset:true}).regex(/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/)
export const toSaleTimestamp=value=>value instanceof Date?value.toISOString():value??null
export function timestampMicros(value){
 const fraction=value.match(/\.(\d+)/)?.[1]??''
 return BigInt(Date.parse(value.replace(/\.\d+/,'')))*1000n+BigInt(fraction.padEnd(6,'0'))
}
export function validateSaleWindow(value,context,{sale='salePrice',start='saleStartsAt',end='saleEndsAt'}={}){
 if(value[start]!=null&&value[end]!=null&&saleTimestamp.safeParse(value[start]).success&&saleTimestamp.safeParse(value[end]).success&&timestampMicros(value[start])>=timestampMicros(value[end])){
  context.addIssue({code:'custom',path:[end],message:'Sale end must follow its start.'})
 }
 if(Object.hasOwn(value,sale)&&(value[sale]===null||value[sale]===0)&&(value[start]!=null||value[end]!=null)){
  context.addIssue({code:'custom',path:[sale],message:'A schedule requires a sale price.'})
 }
}
// Deliberately no environment/client override. Stage 2G.4 must coordinate activation.
// Explicit nulls remain valid for clearing; omitted bounds stay omitted through SQL.
export function scheduledWriteRequested(input){
 return [...(input.variants??[]),...(input.variations??[]),input.definition??{}].some(row=>
  ['saleStartsAt','saleEndsAt','fixedSaleStartsAt','fixedSaleEndsAt'].some(key=>row[key]!=null))
}
