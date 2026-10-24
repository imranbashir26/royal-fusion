// Sanitized production metadata supplied by the user, collected on PostgreSQL 17.6.
// Disposable database fixture only: no env, connection strings, or network clients.
// Keep prosrc bytes explicit so source LF/CRLF conversion cannot change the fixture.
export const verifiedRlsAutoEnableBody = "\nDECLARE\n  cmd record;\nBEGIN\n  FOR cmd IN\n    SELECT *\n    FROM pg_event_trigger_ddl_commands()\n    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')\n      AND object_type IN ('table','partitioned table')\n  LOOP\n     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN\n      BEGIN\n        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);\n        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;\n      EXCEPTION\n        WHEN OTHERS THEN\n          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;\n      END;\n     ELSE\n        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;\n     END IF;\n  END LOOP;\nEND;\n"

export const verifiedPlatformEventTriggers = [
 ['issue_graphql_placeholder','sql_drop','DROP EXTENSION','set_graphql_placeholder'],
 ['issue_pg_cron_access','ddl_command_end','CREATE EXTENSION','grant_pg_cron_access'],
 ['issue_pg_graphql_access','ddl_command_end','CREATE EXTENSION','grant_pg_graphql_access'],
 ['issue_pg_net_access','ddl_command_end','CREATE EXTENSION','grant_pg_net_access'],
 ['pgrst_ddl_watch','ddl_command_end',null,'pgrst_ddl_watch'],
 ['pgrst_drop_watch','sql_drop',null,'pgrst_drop_watch'],
]

// Snapshot includes bodies to prove migration/rerun preservation, not to approve
// unknown production platform bodies. Only rls_auto_enable has a supplied body.
export const productionEventSnapshotSQL = `select jsonb_agg(jsonb_build_array(
 e.evtname,e.evtevent,r.rolname,e.evtenabled,e.evttags,n.nspname,p.proname,
 pg_get_function_identity_arguments(p.oid),fr.rolname,p.prosecdef,p.proconfig,p.prosrc)
 order by e.evtname) state from pg_event_trigger e join pg_roles r on r.oid=e.evtowner
 join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace
 join pg_roles fr on fr.oid=p.proowner`

export async function installProductionCatalogMetadata(db) {
 // Vanilla PostgreSQL requires superuser event-trigger owners. This isolated
 // fixture role models ownership only; no Supabase default privileges are added.
 await db.exec(`do $$ begin
  if not exists(select 1 from pg_roles where rolname='supabase_admin') then
   create role supabase_admin superuser;
  end if;
 end $$;create schema if not exists extensions;`)
 for(const [name,event,tag,fn] of verifiedPlatformEventTriggers) {
  // Fixture-only no-op callbacks: Supabase extension/notification bodies were
  // not supplied. Match verified schema/signature/owner/security/search_path;
  // the manifest pins those fields without inventing platform implementation.
  await db.exec(`create function extensions.${fn}() returns event_trigger
   language plpgsql security invoker set search_path='' as $$begin end$$;
   alter function extensions.${fn}() owner to supabase_admin;
   create event trigger ${name} on ${event} ${tag?`when tag in ('${tag}')`:''}
    execute function extensions.${fn}();
   alter event trigger ${name} owner to supabase_admin;`)
 }
 await db.exec(`
  create function public.rls_auto_enable() returns event_trigger
   language plpgsql security definer set search_path=pg_catalog as $function$${verifiedRlsAutoEnableBody}$function$;
  alter function public.rls_auto_enable() owner to postgres;
  revoke all on function public.rls_auto_enable() from public,anon,authenticated,service_role;
  grant execute on function public.rls_auto_enable() to public;
  create event trigger ensure_rls on ddl_command_end
   when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
   execute function public.rls_auto_enable();
  -- No global function-default ACL row: PostgreSQL's PUBLIC EXECUTE still applies.
  alter default privileges for role postgres in schema public grant execute on functions to postgres;
  alter default privileges for role postgres in schema public grant select,update,usage on sequences to postgres;
  alter default privileges for role postgres in schema public grant all on tables to postgres;
  alter default privileges for role postgres in schema public grant truncate,references,trigger,maintain on tables to anon,authenticated,service_role;
 `)
}

// Shared adversarial inputs for in-memory and native PostgreSQL guard tests.
const event = "on ddl_command_end when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') execute function public.rls_auto_enable()"
export const productionCatalogDriftCases = [
 ['function body', `create or replace function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path=pg_catalog as $function$${verifiedRlsAutoEnableBody.replace('END;\n','END; -- altered body\n')}$function$`],
 ['function owner','alter function public.rls_auto_enable() owner to service_role'],
 ['function security mode','alter function public.rls_auto_enable() security invoker'],
 ['function search path','alter function public.rls_auto_enable() set search_path=public'],
 ['unexpected direct EXECUTE','grant execute on function public.rls_auto_enable() to anon'],
 ['unexpected grant option','grant execute on function public.rls_auto_enable() to authenticated with grant option'],
 ['event removed','drop event trigger ensure_rls'],
 ['event disabled','alter event trigger ensure_rls disable'],
 ['event owner','create role fixture_event_owner superuser;alter event trigger ensure_rls owner to fixture_event_owner'],
 ['event changed', "drop event trigger ensure_rls;create event trigger ensure_rls on ddl_command_start when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') execute function public.rls_auto_enable()"],
 ['event tags', "drop event trigger ensure_rls;create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE') execute function public.rls_auto_enable()"],
 ['wrong callback outside public', "create function auth.fixture_wrong_event() returns event_trigger language plpgsql as $$begin end$$;drop event trigger ensure_rls;create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') execute function auth.fixture_wrong_event()"],
 ['additional equivalent event',`create event trigger fixture_extra_rls ${event}`],
 ['unexpected public function','create function public.fixture_unapproved() returns integer language sql as $$select 1$$'],
 ...['issue_graphql_placeholder','issue_pg_cron_access','issue_pg_graphql_access','issue_pg_net_access','pgrst_ddl_watch','pgrst_drop_watch']
  .map(name=>['missing platform trigger '+name,'drop event trigger '+name]),
 ['unexpected extension-schema event',"create event trigger fixture_extra_platform on ddl_command_end execute function extensions.pgrst_ddl_watch()"],
 ['platform trigger disabled','alter event trigger pgrst_ddl_watch disable'],
 ['platform trigger owner','alter event trigger pgrst_ddl_watch owner to postgres'],
 ['platform event changed',"drop event trigger pgrst_ddl_watch;create event trigger pgrst_ddl_watch on sql_drop execute function extensions.pgrst_ddl_watch();alter event trigger pgrst_ddl_watch owner to supabase_admin"],
 ['NULL tags become non-NULL',"drop event trigger pgrst_ddl_watch;create event trigger pgrst_ddl_watch on ddl_command_end when tag in ('CREATE TABLE') execute function extensions.pgrst_ddl_watch();alter event trigger pgrst_ddl_watch owner to supabase_admin"],
 ['NULL tags become empty array',"update pg_event_trigger set evttags='{}'::text[] where evtname='pgrst_ddl_watch'"],
 ['non-NULL tags become NULL',"drop event trigger issue_pg_cron_access;create event trigger issue_pg_cron_access on ddl_command_end execute function extensions.grant_pg_cron_access();alter event trigger issue_pg_cron_access owner to supabase_admin"],
 ['platform callback schema',"create function auth.pgrst_ddl_watch() returns event_trigger language plpgsql security invoker set search_path='' as $$begin end$$;alter function auth.pgrst_ddl_watch() owner to supabase_admin;drop event trigger pgrst_ddl_watch;create event trigger pgrst_ddl_watch on ddl_command_end execute function auth.pgrst_ddl_watch();alter event trigger pgrst_ddl_watch owner to supabase_admin"],
 ['platform callback function',"drop event trigger pgrst_ddl_watch;create event trigger pgrst_ddl_watch on ddl_command_end execute function extensions.pgrst_drop_watch();alter event trigger pgrst_ddl_watch owner to supabase_admin"],
 ['platform callback owner','alter function extensions.pgrst_ddl_watch() owner to postgres'],
 ['platform callback security','alter function extensions.pgrst_ddl_watch() security definer'],
 ['platform callback config',"alter function extensions.pgrst_ddl_watch() set search_path=public"],
]
