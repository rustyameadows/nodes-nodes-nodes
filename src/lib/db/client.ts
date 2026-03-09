import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { getDatabaseFilePath } from "@/lib/runtime/app-paths";

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  sqlite?: Database.Database;
  db?: AppDatabase;
};

function configureSqlite(sqlite: Database.Database) {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  bootstrapDatabase(sqlite);
}

export function getSqlite() {
  if (!globalForDb.sqlite) {
    globalForDb.sqlite = new Database(getDatabaseFilePath());
    configureSqlite(globalForDb.sqlite);
  }

  return globalForDb.sqlite;
}

export function getDb() {
  if (!globalForDb.db) {
    globalForDb.db = drizzle(getSqlite(), { schema });
  }

  return globalForDb.db;
}
