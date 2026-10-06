// Development-only compiler for 012's literal target contract. Review its output as SQL.
// Baseline guards are never regenerated. Uses only disposable in-memory PostgreSQL.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { testerBaseline } from '../tests/support/testerCatalogDatabase.js'
const path=new URL('../../supabase/migrations/012_tester_catalog_foundation.sql',import.meta.url)
let sql=(await readFile(path,'utf8')).replaceAll('\r\n','\n')
const {db}=await testerBaseline()
try {
 await db.exec(sql.match(/execute \$catalog_ddl\$([\s\S]*?)\$catalog_ddl\$/)[1])
 const query=sql.match(/\n (select jsonb_build_object\(\n 'columns',[\s\S]*?) into installed_shape;/)[1]
 const shape=(await db.query(query+' shape')).rows[0].shape
 sql=sql.replace(/\$target\$[\s\S]*?\$target\$::jsonb/,()=>'$target$'+JSON.stringify(shape,null,2)+'$target$::jsonb')
 const names=[...sql.matchAll(/create function public\.([a-z_]+)\(/g)].map(m=>m[1]).concat('save_catalog_product_012_internal')
 const rows=(await db.query('select proname,prosrc from pg_proc where pronamespace=$1::regnamespace and proname=any($2::text[]) order by proname',['public',names])).rows
 const md5=body=>createHash('md5').update(body).digest('hex')
 const values=rows.map(r=>{const lf=r.prosrc.replaceAll('\r\n','\n');return `('${r.proname}','${md5(lf)}','${md5(lf.replaceAll('\n','\r\n'))}')`}).join(',\n')
 sql=sql.replace(/for item in select \* from \(values\n[\s\S]*?\n\) as approved/,()=> 'for item in select * from (values\n'+values+'\n) as approved')
 await writeFile(path,sql)
 console.log('012 target manifest refreshed from local DDL; baseline contract unchanged.')
} finally {await db.close()}
