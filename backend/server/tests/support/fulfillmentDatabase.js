import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createCatalogDatabase } from './catalogDatabase.js';
export async function fulfillmentDatabase() {
    const db = await createCatalogDatabase();
    for (const name of ['003_auth_schema_hardening.sql', '010_checkout_product_locking.sql', '011_admin_order_fulfillment.sql'])
        await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    return db;
}
// Bound-value PostgREST adapter exclusively for the disposable SQL tests.
export function sqlClient(db) {
    return {
        from(table) {
            assert.match(table, /^[a-z_]+$/);
            let columns = '*', filters = [], values = [], orders = [], limit = '', single = false, count = false;
            const name = v => {
                assert.match(v, /^[a-z_]+$/);
                return `"${v}"`;
            }, param = v => {
                values.push(v);
                return `$${values.length}`;
            };
            const q = {
                select(c, opt) {
                    columns = c.split(',').map(name).join(',');
                    count = opt?.count === 'exact';
                    return q;
                }, eq(c, v) {
                    filters.push(`${name(c)}=${param(v)}`);
                    return q;
                }, in(c, v) {
                    filters.push(v.length ? `${name(c)} in (${v.map(param).join(',')})` : 'false');
                    return q;
                }, gte(c, v) {
                    filters.push(`${name(c)}>=${param(v)}`);
                    return q;
                }, lte(c, v) {
                    filters.push(`${name(c)}<=${param(v)}`);
                    return q;
                },
                or(expression) {
                    const parts = [...expression.matchAll(/([a-z_]+)\.ilike\.("(?:\\.|[^"])*")/g)];
                    assert.equal(parts.length, 4);
                    filters.push('(' + parts.map(m => `${name(m[1])} ilike ${param(JSON.parse(m[2]))}`).join(' or ') + ')');
                    return q;
                }, order(c, { ascending = true } = {}) {
                    orders.push(`${name(c)} ${ascending ? 'asc' : 'desc'}`);
                    return q;
                }, range(a, b) {
                    assert.ok(Number.isInteger(a) && Number.isInteger(b));
                    limit = ` limit ${b - a + 1} offset ${a}`;
                    return q;
                }, maybeSingle() {
                    single = true;
                    return q;
                },
                then(resolve, reject) {
                    const where = filters.length ? ' where ' + filters.join(' and ') : '';
                    return (async () => {
                        try {
                            const result = await db.query(`select ${columns} from public.${name(table)}${where}${orders.length ? ' order by ' + orders.join(',') : ''}${limit}`, values);
                            const total = count ? (await db.query(`select count(*)::int n from public.${name(table)}${where}`, values)).rows[0].n : null;
                            return {
                                data: single ? result.rows[0] ?? null : result.rows, count: total, error: null
                            };
                        }
                        catch (error) {
                            return {
                                data: null, error: {
                                    code: error.code, message: error.message
                                }
                            };
                        }
                    })().then(resolve, reject);
                },
            };
            return q;
        }, async rpc(name, args) {
            try {
                assert.equal(name, 'apply_admin_order_action');
                const r = await db.query('select public.apply_admin_order_action($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::jsonb,$7) result', [args.p_order_id, args.p_actor_id, args.p_action, args.p_mutation_id, args.p_expected_revision, JSON.stringify(args.p_payload), args.p_request_id]);
                return {
                    data: r.rows[0].result, error: null
                };
            }
            catch (e) {
                return {
                    data: null, error: {
                        code: e.code, message: e.message
                    }
                };
            }
        }
    };
}
export async function seedActor(db, key) {
    const id = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.invalid`]);
    await db.query('insert into public.user_roles(user_id,role_id) select $1,id from public.roles where key=$2', [id, key]);
    return id;
}
export async function seedOrder(db, method = 'Cash on Delivery', quantity = 2) {
    const product = randomUUID(), variant = randomUUID();
    await db.query("insert into public.products(id,name,slug,sku,price,scent_family,main_image_url,status,active) values($1,'Baraan',$2,$2,2900,'Woody','https://example.invalid/product','Published',true)", [product, product]);
    await db.query("insert into public.product_variants(id,product_id,option_value,sku,regular_price,stock_quantity) values($1::uuid,$2,'50 ml',$1::uuid::text,2900,12)", [variant, product]);
    await db.exec("insert into public.shipping_methods(code,name,base_fee) values('fixture','Fixture',250) on conflict do nothing");
    const key = `checkout:${randomUUID()}`;
    const result = await db.query('select public.create_order_transaction($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,null,null,null) receipt', [key, JSON.stringify([{
                variantId: variant, quantity
            }]), JSON.stringify({
            name: 'Fixture', email: 'fixture@example.invalid', phone: '00000000000'
        }), JSON.stringify({
            address: 'Fictional Address', city: 'Karachi', province: 'Sindh', notes: 'Customer note'
        }), method]);
    return {
        id: result.rows[0].receipt.id, product, variant, key
    };
}
export async function revision(db, id) {
    return String((await db.query('select revision from public.orders where id=$1', [id])).rows[0].revision);
}
