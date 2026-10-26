import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const migrationCommand = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm'
const migrationArguments = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm run db:migrate']
  : ['run', 'db:migrate']
const migration = spawnSync(migrationCommand, migrationArguments, {
  cwd: projectRoot,
  stdio: 'inherit',
})

if (migration.error) throw migration.error
if (migration.status !== 0) process.exit(migration.status ?? 1)

await import('./index.js')
