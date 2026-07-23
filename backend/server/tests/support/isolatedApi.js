import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export async function startIsolatedApi() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'royal-fusion-auth-test-'))
  const dbPath = path.join(root, 'db.test.json')
  const dotenvPath = path.join(root, 'intentionally-missing.env')
  const port = await reservePort()
  await writeFile(dbPath, `${JSON.stringify(createFixture(), null, 2)}\n`, 'utf8')

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: backendRoot,
    env: createSanitizedEnvironment({ dbPath, dotenvPath, port }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const output = []
  child.stdout.on('data', (chunk) => output.push(String(chunk)))
  child.stderr.on('data', (chunk) => output.push(String(chunk)))
  await waitForServer(child, output, port)

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async readFixtureDb() {
      return JSON.parse(await readFile(dbPath, 'utf8'))
    },
    async stop() {
      if (child.exitCode === null) {
        child.kill()
        await Promise.race([
          new Promise((resolve) => child.once('exit', resolve)),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ])
      }
      await rm(root, { recursive: true, force: true })
    },
  }
}

function createSanitizedEnvironment({ dbPath, dotenvPath, port }) {
  const safeSystemKeys = ['PATH', 'Path', 'SystemRoot', 'ComSpec', 'WINDIR', 'PATHEXT']
  const env = Object.fromEntries(
    safeSystemKeys.filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
  )
  return {
    ...env,
    NODE_ENV: 'test',
    PORT: String(port),
    RF_DB_PATH: dbPath,
    DOTENV_CONFIG_PATH: dotenvPath,
    USE_SUPABASE: 'false',
    JWT_SECRET: 'x'.repeat(32),
  }
}

function createFixture() {
  return {
    products: [
      {
        id: 'product-selected',
        name: 'Fictional Selected Fragrance',
        status: 'Published',
        stock: 8,
        category: 'Unisex',
        price: 1200,
        salePrice: 0,
        sizeOptions: [{ value: '50 ml', price: 1000 }],
      },
      {
        id: 'product-unselected',
        name: 'Fictional Unselected Fragrance',
        status: 'Published',
        stock: 6,
        category: 'Unisex',
        price: 2000,
        salePrice: 0,
        sizeOptions: [{ value: '100 ml', price: 2000 }],
      },
    ],
    coupons: [
      {
        id: 'coupon-fictional',
        code: 'FICTIONAL10',
        type: 'Percentage',
        discountValue: 10,
        status: 'Active',
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2099-01-01T00:00:00.000Z',
        usageLimit: 10,
        usedCount: 0,
        minimumOrderAmount: 500,
        applicableProducts: [],
        applicableCategories: [],
      },
    ],
    customers: [],
    orders: [],
    users: [],
    shipping: {
      defaultShippingFee: 300,
      freeShippingAbove: 5000,
      cityWise: [],
      provinceWise: [],
    },
  }
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

async function waitForServer(child, output, port) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Isolated API exited before startup: ${output.join('').trim()}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/public/products`)
      if (response.ok) return
    } catch {
      // The isolated loopback server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill()
  throw new Error(`Isolated API did not start: ${output.join('').trim()}`)
}
