import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

dotenv.config({ path: '.env.local' })

process.env.DATABASE_URL ||= 'file:./project.db'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
