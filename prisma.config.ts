import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

dotenv.config({ path: '.env.local' })

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing. Add the managed PostgreSQL Internal Database URL to the Render Web Service environment (not just the database service), then redeploy.')
}
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error('DATABASE_URL must be a PostgreSQL connection URL, not a SQLite file path.')
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/postgresql-migrations',
  },
  datasource: {
    url: databaseUrl,
  },
})
