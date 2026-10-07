// Local disposable manifest generation only; never reads env or connects to Supabase.
import { readFile, writeFile } from 'node:fs/promises'
import { baselineV2, migrationURL, shapeSQL } from '../tests/support/checkoutV2Database.js'
const {db}=await baselineV2()
try {
 const source=(await readFile(migrationURL,'utf8')).replaceAll('\r\n','\n')
 const ddl=source.split('-- @013-DDL-BEGIN\n')[1].split('-- @013-DDL-END')[0]
 const baseline=(await db.query(shapeSQL)).rows[0].shape
 await db.exec('begin;\n'+ddl+'\ncommit;')
 const target=(await db.query(shapeSQL)).rows[0].shape
 const query=shapeSQL.replace(' as shape',' into shape')
 const result=`-- Forward-only Phase 013. Owner-only v2 orders until fulfillment 014.\n-- Semantic PG17/18 manifests: strict nullability/constraint flags and effective ACLs.\n-- Only generated NOT NULL names and redundant owner/service view MAINTAIN bits normalize.\n-- Function bodies normalize CRLF to LF; runtime DDL is unchanged.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='60s';\nset local search_path=pg_catalog,public;\ndo $install013$\ndeclare shape text;\nbegin\n ${query};\n if exists(select 1 from pg_attribute where attrelid='public.orders'::regclass and attname='checkout_version' and not attisdropped) then\n  if shape is distinct from '${target}' then raise exception 'RF_CHECKOUT_013_TARGET_DRIFT'; end if;\n else\n  if shape is distinct from '${baseline}' then raise exception 'RF_CHECKOUT_013_BASELINE_DRIFT'; end if;\n  execute $ddl013$\n-- @013-DDL-BEGIN\n${ddl}-- @013-DDL-END\n$ddl013$;\n  ${query};\n  if shape is distinct from '${target}' then raise exception 'RF_CHECKOUT_013_INSTALL_DRIFT'; end if;\n end if;\nend; $install013$;\ncommit;\n`
 await writeFile(migrationURL,result)
 console.log({baseline,target})
} finally {await db.close()}
