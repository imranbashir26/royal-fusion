-- LOCAL OR DISPOSABLE STAGING ONLY. Start while session A is sleeping.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select public.create_order_transaction(
  'concurrency-session-b',
  jsonb_build_array(jsonb_build_object(
    'variantId', (select id from public.product_variants where sku = 'RF-SHAHEEN-30ML'),
    'quantity', 20
  )),
  '{"name":"Concurrency B","email":"concurrency-b@example.invalid","phone":"+92 300 0000022"}'::jsonb,
  '{"address":"Fictional Address B","city":"Karachi","province":"Sindh"}'::jsonb,
  'Cash on Delivery', null, null, null
);

rollback;
