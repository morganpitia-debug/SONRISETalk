import initSqlJs from 'sql.js'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const { Client } = pg
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function readRows(database, table) {
  const statement = database.prepare(`SELECT * FROM ${quoteIdentifier(table)}`)
  const rows = []
  try {
    while (statement.step()) rows.push(statement.getAsObject())
  } finally {
    statement.free()
  }
  return rows
}

function tableDependencies(database, tables) {
  const knownTables = new Set(tables)
  return new Map(tables.map((table) => {
    const result = database.exec(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
    const dependencies = new Set((result[0]?.values ?? [])
      .map((row) => row[2])
      .filter((parent) => parent !== table && knownTables.has(parent)))
    return [table, dependencies]
  }))
}

function sortTables(tables, dependencies) {
  const remaining = new Set(tables)
  const sorted = []
  while (remaining.size) {
    const ready = [...remaining]
      .filter((table) => [...dependencies.get(table)].every((parent) => !remaining.has(parent)))
      .sort()
    if (!ready.length) throw new Error('The SQLite schema contains circular table dependencies; import was not started.')
    ready.forEach((table) => {
      remaining.delete(table)
      sorted.push(table)
    })
  }
  return sorted
}

function sortSelfReferentialRows(database, table, rows) {
  const foreignKeys = database.exec(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)[0]?.values ?? []
  const selfReferences = foreignKeys
    .filter((row) => row[2] === table)
    .map((row) => ({ field: row[4], parentField: row[3] }))
  if (!selfReferences.length) return rows

  const index = new Map()
  for (const row of rows) {
    for (const { parentField } of selfReferences) {
      index.set(`${parentField}:${row[parentField]}`, row)
    }
  }
  const visiting = new Set()
  const visited = new Set()
  const sorted = []
  function visit(row) {
    if (visited.has(row)) return
    if (visiting.has(row)) throw new Error(`The SQLite table "${table}" contains a self-reference cycle.`)
    visiting.add(row)
    for (const { field, parentField } of selfReferences) {
      const parent = index.get(`${parentField}:${row[field]}`)
      if (parent) visit(parent)
    }
    visiting.delete(row)
    visited.add(row)
    sorted.push(row)
  }
  rows.forEach(visit)
  return sorted
}

function convertValue(value, type) {
  if (value === null || value === undefined) return null
  if (type === 'boolean') return Boolean(value)
  if (type === 'json' || type === 'jsonb') return typeof value === 'string' ? JSON.parse(value) : value
  return value
}

async function insertRows(client, table, rows, columns) {
  const columnNames = columns.map(({ column_name }) => column_name)
  const columnList = columnNames.map(quoteIdentifier).join(', ')
  const batchSize = Math.max(1, Math.floor(60000 / columnNames.length))
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize)
    const values = []
    const placeholders = batch.map((row, rowIndex) => {
      const rowPlaceholders = columnNames.map((columnName, columnIndex) => {
        const parameter = rowIndex * columnNames.length + columnIndex + 1
        const column = columns[columnIndex]
        values.push(convertValue(row[columnName], column.data_type))
        return `$${parameter}`
      })
      return `(${rowPlaceholders.join(', ')})`
    })
    await client.query(`INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES ${placeholders.join(', ')}`, values)
  }
}

export async function importSQLiteDatabase({ sqlitePath, client, onProgress = console.log }) {
  try {
    if ((await stat(`${sqlitePath}-wal`)).size > 0) {
      throw new Error('Stop the application and checkpoint the SQLite database before importing; its write-ahead log is not empty.')
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const SQL = await initSqlJs()
  const source = new SQL.Database(await readFile(sqlitePath))
  try {
    const integrity = source.exec('PRAGMA integrity_check')[0]?.values[0][0]
    if (integrity !== 'ok') throw new Error(`The SQLite source failed its integrity check: ${integrity ?? 'no result'}`)
    const sourceTables = source.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name")[0]?.values.map(([name]) => name) ?? []
    if (!sourceTables.length) throw new Error(`No application tables were found in the SQLite source: ${sqlitePath}`)

    const migrationTable = source.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'")[0]
    if (migrationTable) {
      const unfinished = source.exec("SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")[0]?.values[0][0] ?? 0
      if (unfinished) throw new Error('The SQLite source has an unfinished migration; resolve it before importing data.')
    }

    const orderedTables = sortTables(sourceTables, tableDependencies(source, sourceTables))
    const targetTables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
    )
    const targetNames = new Set(targetTables.rows.map(({ table_name }) => table_name))
    const missingTables = sourceTables.filter((table) => !targetNames.has(table))
    if (missingTables.length) throw new Error(`Apply PostgreSQL migrations first; missing target tables: ${missingTables.join(', ')}`)

    const columnInfo = new Map()
    for (const table of sourceTables) {
      const columns = await client.query(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position',
        [table],
      )
      const sourceColumns = source.exec(`PRAGMA table_info(${quoteIdentifier(table)})`)[0]?.values.map((row) => row[1]) ?? []
      const missingColumns = sourceColumns.filter((column) => !columns.rows.some((target) => target.column_name === column))
      if (missingColumns.length) throw new Error(`SQLite table "${table}" has columns missing from PostgreSQL: ${missingColumns.join(', ')}`)
      columnInfo.set(table, columns.rows)
    }

    await client.query('BEGIN')
    try {
      await client.query(`LOCK TABLE ${sourceTables.map(quoteIdentifier).join(', ')} IN EXCLUSIVE MODE`)
      for (const table of sourceTables) {
        const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(table)}`)
        if (String(result.rows[0].count) !== '0') {
          throw new Error(`PostgreSQL table "${table}" is not empty. Import stopped to avoid overwriting or duplicating data.`)
        }
      }

      for (const table of orderedTables) {
        const rows = sortSelfReferentialRows(source, table, readRows(source, table))
        await insertRows(client, table, rows, columnInfo.get(table))
        onProgress(`Imported ${rows.length} rows from ${table}.`)
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
    onProgress('SQLite data import completed. The source database was not modified.')
  } finally {
    source.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error('Set DATABASE_URL to the target PostgreSQL connection string before importing.')
  }
  const sqlitePath = path.resolve(projectRoot, process.env.SQLITE_SOURCE_PATH || 'project.db')
  const client = new Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await importSQLiteDatabase({ sqlitePath, client })
  } finally {
    await client.end()
  }
}
