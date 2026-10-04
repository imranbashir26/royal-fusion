import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createCatalogDatabase } from './catalogDatabase.js'
import { sqlClient } from './fulfillmentDatabase.js'

// Exact 496-byte production prosrc, including leading/trailing CRLF and indentation.
export const verifiedLegacyPermissionBody = "\r\n  select exists (\r\n    select 1\r\n    from public.user_roles user_roles\r\n    join public.roles roles on roles.id = user_roles.role_id\r\n    join public.role_permissions role_permissions on role_permissions.role_id = roles.id\r\n    join public.permissions permissions on permissions.id = role_permissions.permission_id\r\n    where user_roles.user_id = auth.uid()\r\n      and user_roles.active\r\n      and roles.active\r\n      and (permissions.key = required_permission or permissions.key = '*')\r\n  );\r\n"
export async function installVerifiedLegacyPermission(db, body = verifiedLegacyPermissionBody) {
  await db.exec(`create or replace function public.has_permission(required_permission text)
    returns boolean language sql stable security definer set search_path='' as $$${body}$$;
    alter function public.has_permission(text) owner to postgres;
    revoke execute on function public.has_permission(text) from public,anon;
    grant execute on function public.has_permission(text) to authenticated,service_role;`)
}

// Exact 113-byte production prosrc; explicit escapes survive source line-ending conversion.
export const verifiedLegacyRevocationBody = "\r\nbegin\r\n  raise exception using\r\n    errcode = '23514',\r\n    message = 'RF_SESSION_REVOCATION_REQUIRED';\r\nend;\r\n"
export async function installVerifiedLegacyRevocation(db, body = verifiedLegacyRevocationBody) {
  await db.exec(`create or replace function public.require_session_revocation()
    returns trigger language plpgsql volatile security definer set search_path='' as $$${body}$$;
    alter function public.require_session_revocation() owner to postgres;
    revoke execute on function public.require_session_revocation() from public,anon,authenticated,service_role;`)
}

export async function legacyAdminDatabase() {
  const db = await createCatalogDatabase()
  const admin = randomUUID(), customer = randomUUID()
  for (const id of [admin,customer]) await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.invalid`])
  await db.query("insert into public.user_roles(user_id,role_id) select $1,id from public.roles where key='owner_admin'", [admin])
  await installVerifiedLegacyPermission(db)
  await installVerifiedLegacyRevocation(db)
  return { db, admin, customer }
}
export async function applyRelease(db, name, admin) {
  await db.query("select set_config('royal_fusion.approved_admin_uuid',$1,false)", [admin])
  try { await db.exec(await readFile(new URL(`../../../supabase/release-migrations/${name}`,import.meta.url),'utf8')) }
  catch (error) { await db.exec('rollback'); throw new Error(error.message + (error.position ? " near: " + error.query?.slice(Number(error.position)-80,Number(error.position)+100) : ""), {cause:{code:error.code}}) }
}
// Disposable, bound-parameter SQL adapter for the actual session/profile services.
export function sessionSqlClient(db) {
  const read = sqlClient(db)
  const ident = value => { if (!/^[a-z_]+$/.test(value)) throw new Error('Invalid test identifier'); return `"${value}"` }
  return {
    from(table) {
      const reader = read.from(table)
      const mutation = (values,insert) => {
        const parameters=[], clauses=[]; let columns='*', single=false
        const param = value => { parameters.push(typeof value==='object' && value!==null ? JSON.stringify(value) : value); return `$${parameters.length}` }
        const names=Object.keys(values)
        const statement=insert ? `insert into public.${ident(table)}(${names.map(ident)}) values(${names.map(k=>param(values[k]))})`
          : `update public.${ident(table)} set ${names.map(k=>`${ident(k)}=${param(values[k])}`).join(',')}`
        const query={
          select(value) { columns=value.split(',').map(ident).join(','); return query },
          eq(key,value) { clauses.push(`${ident(key)}=${param(value)}`); return query },
          is(key,value) { if(value!==null)throw new Error('Test supports null only'); clauses.push(`${ident(key)} is null`);return query },
          maybeSingle() {single=true;return query},
          then(resolve,reject) { return db.query(`${statement}${clauses.length?' where '+clauses.join(' and '):''} returning ${columns}`,parameters)
            .then(r=>({data:single?r.rows[0]??null:r.rows,error:null}),e=>({data:null,error:{code:e.code}})).then(resolve,reject) },
        }
        return query
      }
      return { ...reader, insert:values=>mutation(values,true), update:values=>mutation(values,false) }
    },
    async rpc(name,args) {
      try {
        if(name==='claim_application_session_refresh') {
          const r=await db.query('select public.claim_application_session_refresh($1,$2,$3::timestamptz,$4::integer) value',Object.values(args))
          return {data:r.rows[0].value,error:null}
        }
        if(name==='release_application_session_refresh') {
          const r=await db.query('select public.release_application_session_refresh($1,$2) value',Object.values(args))
          return {data:r.rows[0].value,error:null}
        }
        return read.rpc(name,args)
      } catch(e) { return {data:null,error:{code:e.code}} }
    },
  }
}
