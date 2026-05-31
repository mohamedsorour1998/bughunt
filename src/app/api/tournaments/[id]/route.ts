// src/app/api/tournaments/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getTournament } from "@/lib/tournaments"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const result = await getTournament(id)

  if (!result) {
    return NextResponse.json({ error: "Tournament not found" }, { status: 404 })
  }

  return NextResponse.json(result)
}
