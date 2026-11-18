import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import { popularDemonstracao } from "./seed";

export type Db = PgliteDatabase<typeof schema>;

// Postgres local (PGlite) para o protótipo. Em produção, trocar o driver por
// drizzle-orm/node-postgres apontando para um Postgres comum; o esquema é o mesmo.
const globalDb = globalThis as unknown as { comautoDb?: Promise<Db> };

async function iniciar(): Promise<Db> {
  const pasta = path.join(process.cwd(), ".data", "pglite");
  mkdirSync(pasta, { recursive: true });
  const client = new PGlite(pasta);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await popularDemonstracao(db);
  return db;
}

export function getDb(): Promise<Db> {
  globalDb.comautoDb ??= iniciar().catch((erro) => {
    // Não guarda a falha: a próxima requisição tenta de novo.
    globalDb.comautoDb = undefined;
    throw erro;
  });
  return globalDb.comautoDb;
}

export { schema };
