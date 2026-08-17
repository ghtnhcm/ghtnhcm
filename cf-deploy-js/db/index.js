import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

// D1 is provided as a native Cloudflare binding (env.DB), configured via
// the [[d1_databases]] entry in wrangler.toml — no connection string needed.
export function getDb(d1) {
  return drizzle(d1, { schema });
}
