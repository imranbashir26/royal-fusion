// Disposable PGlite only. No environment/connection strings; writes only migration 014.
import {readFile,writeFile} from 'node:fs/promises'
import {fixtureV2,shapeSQL} from '../tests/support/checkoutV2Database.js'
import {installProductionCatalogMetadata} from '../tests/support/productionCatalogFixture.js'
const url=new URL('../../supabase/migrations/014_tester_pack_fulfillment.sql',import.meta.url)
const source=(await readFile(url,'utf8')).replaceAll('\r\n','\n')
const ddl=source.split('-- @014-DDL-BEGIN\n')[1].split('-- @014-DDL-END')[0]
const baselines=[],targets=[]
for(const production of [false,true]) {
 const {db}=await fixtureV2()
 try {
  if(production) await installProductionCatalogMetadata(db)
  baselines.push((await db.query(shapeSQL)).rows[0].shape)
  await db.exec('begin;\n'+ddl+'\ncommit;')
  targets.push((await db.query(shapeSQL)).rows[0].shape)
 } finally {await db.close()}
}
const approved=values=>values.map(value=>`'${value}'`).join(',')
 const query=shapeSQL.replace(' as shape',' into shape')
 const result=`-- Forward-only local 014. Production ordering remains disabled.\n-- Shared semantic PG17/18 catalog recognition; 014 runtime DDL is unchanged.\n-- Strict nullability/constraint flags and ACLs; function CRLF normalizes to LF.\n-- Exact disposable / verified production catalogs, including event-trigger metadata.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='60s';\nset local search_path=pg_catalog,public;\ndo $install014$\ndeclare shape text;\nbegin\n ${query};\n if to_regprocedure('public.apply_admin_order_action_v2_014_internal(uuid,uuid,text,uuid,text,jsonb,text)') is not null then\n  if shape not in (${approved(targets)}) then raise exception 'RF_FULFILLMENT_014_TARGET_DRIFT'; end if;\n else\n  if shape not in (${approved(baselines)}) then raise exception 'RF_FULFILLMENT_014_BASELINE_DRIFT'; end if;\n  execute $ddl014$\n-- @014-DDL-BEGIN\n${ddl}-- @014-DDL-END\n$ddl014$;\n  ${query};\n  if shape not in (${approved(targets)}) then raise exception 'RF_FULFILLMENT_014_INSTALL_DRIFT'; end if;\n end if;\nend; $install014$;\ncommit;\n`
 await writeFile(url,result);console.log({baselines,targets})
