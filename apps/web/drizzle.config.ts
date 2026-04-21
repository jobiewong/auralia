import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'
import path from 'node:path'

config({ path: ['.env.local', '.env'] })

const configuredDbPath =
  process.env.AURALIA_SQLITE_PATH ?? 'data/db/auralia.sqlite'
const dbUrl = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.join('../..', configuredDbPath)

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbUrl,
  },
})
