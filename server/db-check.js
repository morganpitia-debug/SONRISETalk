import { prisma } from './db.js'

try {
  await prisma.$connect()
  await prisma.$queryRaw`SELECT 1`
  console.log('Prisma connected to PostgreSQL successfully.')
} catch (error) {
  console.error('Prisma could not connect to the configured PostgreSQL database.')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
