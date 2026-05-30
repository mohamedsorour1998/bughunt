import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { deleteItem, queryItems } from "@/lib/dynamodb"
import { getUser } from "@/lib/users"

// All possible elo ranges (0, 200, 400, ..., 3200)
const ELO_RANGES = Array.from({ length: 17 }, (_, i) => i * 200)

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // Search all elo ranges for this user's queue entry and delete it
  await Promise.all(
    ELO_RANGES.map(async (range) => {
      const { items } = await queryItems(
        "pk = :pk",
        { ":pk": `MATCH#QUEUE#${range}` }
      )

      const userEntries = items.filter((item) => {
        // SK format: <timestamp>#<userId>
        const sk = item.sk as string
        return sk.endsWith(`#${userId}`)
      })

      await Promise.all(
        userEntries.map((entry) =>
          deleteItem(entry.pk as string, entry.sk as string)
        )
      )
    })
  )

  return NextResponse.json({ cancelled: true })
}
