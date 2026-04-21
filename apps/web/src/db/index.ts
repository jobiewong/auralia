import { drizzle } from 'drizzle-orm/better-sqlite3'
import path from 'node:path'

import * as schema from './schema.ts'

const repoRoot = new URL('../../../..', import.meta.url).pathname
const configuredDbPath =
  process.env.AURALIA_SQLITE_PATH ?? 'data/db/auralia.sqlite'
const sqlitePath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.join(repoRoot, configuredDbPath)

export const db = drizzle<typeof schema>(sqlitePath, {
  schema,
})
