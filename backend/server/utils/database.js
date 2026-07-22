import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultDbPath = path.resolve(__dirname, '../data/db.json')
const exampleDbPath = path.resolve(__dirname, '../data/db.example.json')
const dbPath = process.env.RF_DB_PATH
  ? path.resolve(process.env.RF_DB_PATH)
  : defaultDbPath

const singularResources = new Set(['settings', 'homepage', 'shipping'])

let writeQueue = Promise.resolve()

export async function readDb() {
  await ensureDbFile()
  const raw = await fs.readFile(dbPath, 'utf8')
  return JSON.parse(raw)
}

export async function writeDb(nextDb) {
  await ensureDbFile()
  writeQueue = writeQueue.then(async () => {
    const tmpPath = `${dbPath}.tmp`
    await fs.writeFile(tmpPath, `${JSON.stringify(nextDb, null, 2)}\n`, 'utf8')
    await fs.rename(tmpPath, dbPath)
  })
  return writeQueue
}

async function ensureDbFile() {
  try {
    await fs.access(dbPath)
  } catch {
    const seed = await fs.readFile(exampleDbPath, 'utf8')
    await fs.writeFile(dbPath, seed, { flag: 'wx' }).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
  }
}

export async function updateDb(updater) {
  const db = await readDb()
  const result = await updater(db)
  await writeDb(db)
  return result
}

export function getResource(db, resource) {
  if (!(resource in db)) {
    throw Object.assign(new Error(`Unknown resource: ${resource}`), { status: 404 })
  }
  return db[resource]
}

export function isSingularResource(resource) {
  return singularResources.has(resource)
}

export function nowIso() {
  return new Date().toISOString()
}
