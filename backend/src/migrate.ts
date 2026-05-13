import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const sqlPath = path.join(__dirname, "../drizzle/0000_init.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

const client = postgres(url, { max: 1 });
await client.unsafe(sql);
await client.end();
console.log("Migrations complete");
