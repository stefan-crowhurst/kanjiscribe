/**
 * Structural SQLite surface shared by the API's boot migrations and the
 * importer's schema-ensure step. Both use better-sqlite3, but the shared
 * package deliberately does not depend on it: anything exposing `prepare`
 * and `exec` qualifies.
 */
export interface SqliteSchemaDatabase {
  prepare(sql: string): { all(): unknown[] };
  exec(sql: string): unknown;
}

function hasColumn(db: SqliteSchemaDatabase, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

export function ensureColumn(
  db: SqliteSchemaDatabase,
  table: string,
  column: string,
  definition: string
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

export function ensureIndex(
  db: SqliteSchemaDatabase,
  index: string,
  table: string,
  column: string
): void {
  db.exec(`CREATE INDEX IF NOT EXISTS ${index} ON ${table}(${column});`);
}

/**
 * Ensures the nullable `romaji` column and its index exist on
 * `entry_reading`. 0001 is CREATE TABLE IF NOT EXISTS, so a pre-feature
 * database keeps its original `entry_reading` shape; both the API's boot
 * migration and the importer's schema-ensure step call this before touching
 * romaji. This fixes the shape only — backfilling existing rows is the boot
 * migration's job (the importer writes romaji only on readings it inserts).
 */
export function ensureEntryReadingRomajiSchema(db: SqliteSchemaDatabase): void {
  ensureColumn(db, 'entry_reading', 'romaji', 'TEXT');
  ensureIndex(db, 'idx_entry_reading_romaji', 'entry_reading', 'romaji');
}
