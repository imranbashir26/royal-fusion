// Every backend test file appears exactly once. Native groups use fresh owned
// clusters; unit includes the existing embedded PGlite SQL regressions.
export const nativeGroups={
 release008_security:['release008-security-validation-native.test.js'],
 security_chain:['release008-platform-guard.test.js'],
 coupon_sale:['coupon-sale-native.test.js'],
 all:['orders-v2.test.js','checkout-v2-sql.test.js','checkout-v2-limits.test.js','tester-catalog-api.test.js'],
 acceptance:['post014-default-acl-hardening.test.js','standard-availability-native.test.js','checked-v1-native.test.js','checked-v1-api-native.test.js','checkout-retirement-native.test.js','scheduled-sales-native.test.js','scheduled-sales-api-native.test.js'],
 compatibility:['checkout-sql.test.js','admin-phase3-checkout.test.js','admin-orders-v2.test.js','customer-account.test.js','fulfillment-v2-sql.test.js'],
}
export const unitFiles=[
 'scheduled-sales-backend.test.js',
 'admin-categories-v1.test.js','admin-collections-v1.test.js','admin-fulfillment-sql.test.js','admin-media-v1.test.js',
 'admin-orders-v1.test.js','admin-phase3.test.js','admin-products-v1.test.js','auth-backend-cookie-sessions.test.js',
 'auth-contract-foundation.test.js','blog-activation.test.js','blog-domain.test.js','blog-html.test.js','blog-sitemap.test.js',
 'catalog-normalization.test.js','catalog-variants.test.js','contact-v1.test.js','dependency-security.test.js',
 'fragrance-finder-v1.test.js','guest-checkout-regression.test.js','newsletter-v1.test.js',
 'orders-v1.test.js','pre013-acl-hardening.test.js','public-settings-contract.test.js','reviews-v1.test.js','sanity-blog-v1.test.js',
 'settings-v1.test.js','single-admin-transition.test.js','tester-catalog-sql.test.js','checkout-v2-protected.test.js','test-orchestration.test.js',
]
export function tapTotals(text){
 const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(name=>[name,Number(text.match(new RegExp('^# '+name+' (\\d+)$','m'))?.[1]??-1)]))
 if(counts.tests<=0||counts.pass!==counts.tests||counts.fail!==0||counts.skipped!==0||counts.cancelled!==0)throw Error('Incomplete or failed test execution: '+JSON.stringify(counts))
 return counts
}
