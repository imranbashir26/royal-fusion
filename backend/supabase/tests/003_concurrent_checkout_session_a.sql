-- LOCAL OR DISPOSABLE STAGING ONLY. Run at the same time as session B.
-- Both scripts target the same variant. One checkout must succeed and the other
-- must wait, then fail if their combined quantity exceeds available stock.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select public.create_order_transaction(
  'concurrency-session-a',
  jsonb_build_array(jsonb_build_object(
    'variantId', (select id from public.product_variants where sku = 'RF-SHAHEEN-30ML'),
    'quantity', 20
  )),
  '{"name":"Concurrency A","email":"concurrency-a@example.invalid","phone":"+92 300 0000021"}'::jsonb,
  '{"address":"Fictional Address A","city":"Karachi","province":"Sindh"}'::jsonb,
  'Cash on Delivery', null, null, null
);

select pg_sleep(10);
commit;
