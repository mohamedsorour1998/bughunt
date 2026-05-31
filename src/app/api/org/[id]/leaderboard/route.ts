// src/app/api/org/[id]/leaderboard/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getOrgLeaderboard } from "@/lib/orgs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const players = await getOrgLeaderboard(id)
  return NextResponse.json({ players })
}
