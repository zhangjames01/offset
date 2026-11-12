import { NextResponse } from "next/server";
import { connection } from "next/server";

export async function GET() {
  await connection();

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}