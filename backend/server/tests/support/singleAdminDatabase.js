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

// Independently verified raw production CRLF bodies; JSON escapes preserve every byte.
export const verifiedLegacySessionFunctions = [
  {"name":"claim_application_session_refresh","types":"text,text,timestamptz,integer","args":"p_session_key_hash text,p_lock_hash text,p_now timestamptz,p_lease_seconds integer","result":"boolean","length":697,"md5":"a2edb69902fc454fd7f2a28e068eba41","lines":28,"service":true,"body":"\r\ndeclare\r\n  claimed_id uuid;\r\nbegin\r\n  if p_session_key_hash !~ '^[0-9a-f]{64}$'\r\n    or p_lock_hash !~ '^[0-9a-f]{64}$'\r\n    or p_lease_seconds < 5\r\n    or p_lease_seconds > 120 then\r\n    return false;\r\n  end if;\r\n\r\n  update public.application_sessions\r\n  set\r\n    refresh_lock_hash = p_lock_hash,\r\n    refresh_locked_until =\r\n      p_now + make_interval(secs => p_lease_seconds)\r\n  where session_key_hash = p_session_key_hash\r\n    and revoked_at is null\r\n    and idle_expires_at > p_now\r\n    and absolute_expires_at > p_now\r\n    and (\r\n      refresh_locked_until is null\r\n      or refresh_locked_until <= p_now\r\n    )\r\n  returning id into claimed_id;\r\n\r\n  return claimed_id is not null;\r\nend;\r\n"},
  {"name":"release_application_session_refresh","types":"text,text","args":"p_session_key_hash text,p_lock_hash text","result":"boolean","length":313,"md5":"8121051a13e394c82c4aefb3408f7685","lines":14,"service":true,"body":"\r\ndeclare\r\n  released_id uuid;\r\nbegin\r\n  update public.application_sessions\r\n  set\r\n    refresh_lock_hash = null,\r\n    refresh_locked_until = null\r\n  where session_key_hash = p_session_key_hash\r\n    and refresh_lock_hash = p_lock_hash\r\n  returning id into released_id;\r\n\r\n  return released_id is not null;\r\nend;\r\n"},
  {"name":"write_application_session_security_audit","types":"","args":"","result":"trigger","length":581,"md5":"04e6a12df58fcf69463e2412b113f4fc","lines":33,"service":false,"body":"\r\ndeclare\r\n  event_action text;\r\nbegin\r\n  if tg_op = 'INSERT' then\r\n    event_action := 'session.created';\r\n\r\n  elsif new.revoked_at is not null\r\n    and old.revoked_at is null then\r\n\r\n    event_action := 'session.revoked';\r\n\r\n  else\r\n    return new;\r\n  end if;\r\n\r\n  insert into public.admin_audit_logs (\r\n    admin_id,\r\n    action,\r\n    resource,\r\n    resource_id,\r\n    metadata\r\n  )\r\n  values (\r\n    coalesce(auth.uid(), new.revoked_by),\r\n    event_action,\r\n    'application_sessions',\r\n    new.id::text,\r\n    jsonb_build_object('operation', tg_op)\r\n  );\r\n\r\n  return new;\r\nend;\r\n"},
]
export async function installVerifiedLegacySessionFunction(db, spec, body = spec.body) {
  await db.exec(`create or replace function public.${spec.name}(${spec.args})
    returns ${spec.result} language plpgsql volatile security definer set search_path='' as $$${body}$$;
    alter function public.${spec.name}(${spec.types}) owner to postgres;
    revoke execute on function public.${spec.name}(${spec.types}) from public,anon,authenticated,service_role;
    ${spec.service ? `grant execute on function public.${spec.name}(${spec.types}) to service_role;` : ''}`)
}

export async function legacyAdminDatabase() {
  const db = await createCatalogDatabase()
  const admin = randomUUID(), customer = randomUUID()
  for (const id of [admin,customer]) await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.invalid`])
  await db.query("insert into public.user_roles(user_id,role_id) select $1,id from public.roles where key='owner_admin'", [admin])
  await installVerifiedLegacyPermission(db)
  await installVerifiedLegacyRevocation(db)
  for (const spec of verifiedLegacySessionFunctions) await installVerifiedLegacySessionFunction(db,spec)
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
