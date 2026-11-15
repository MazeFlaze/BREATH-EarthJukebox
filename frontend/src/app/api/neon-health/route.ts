import { NextResponse } from "next/server";
import { getNeonSql } from "@/lib/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getNeonSql();
    const result = await sql`SELECT NOW() as current_time, current_database() as database, version() as version;`;

    return NextResponse.json({
      status: "healthy",
      service: "neon-postgres",
      branch: process.env.NEON_BRANCH || "production",
      result: result[0],
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        service: "neon-postgres",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
