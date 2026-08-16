import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema.js";

// DATABASE_URL is provided via Cloudflare Pages environment variables.
export function getDb(databaseUrl) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}
