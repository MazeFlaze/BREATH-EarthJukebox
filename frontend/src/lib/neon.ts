import dns from "node:dns";
import net from "node:net";
import { neon } from "@neondatabase/serverless";

// Ensure Node network resolver prefers IPv4 on environments where IPv6 route is unreachable
if (typeof net.setDefaultAutoSelectFamily === "function") {
  net.setDefaultAutoSelectFamily(false);
}
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

/**
 * Returns a Neon serverless SQL query client.
 * Uses HTTP transport for lightweight, instant, scale-to-zero serverless queries.
 */
export function getNeonSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not defined.");
  }
  return neon(databaseUrl);
}
