import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/index.js'

dotenv.config({ path: '.env.local' })

const databaseUrl = process.env.DATABASE_URL || 'file:./project.db'
if (!databaseUrl.startsWith('file:')) {
  throw new Error('DATABASE_URL must use a SQLite file: URL.')
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databasePath = databaseUrl.slice('file:'.length)
const absoluteDatabasePath = path.isAbsolute(databasePath)
  ? databasePath
  : path.resolve(projectRoot, databasePath)
const adapter = new PrismaBetterSqlite3({ url: `file:${absoluteDatabasePath}` })
const globalForPrisma = globalThis

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
