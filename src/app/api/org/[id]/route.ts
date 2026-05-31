// src/app/api/org/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getOrg } from "@/lib/orgs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const result = await getOrg(id)

  if (!result.org) {
    return NextResponse.json({ error: "Org not found" }, { status: 404 })
  }

  return NextResponse.json(result)
}
