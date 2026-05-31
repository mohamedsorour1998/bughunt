import { ImageResponse } from "@vercel/og"
import { NextRequest } from "next/server"

export const runtime = "edge"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0]
  const time = searchParams.get("time") ?? "0"
  const rank = searchParams.get("rank") ?? "?"
  const correct = searchParams.get("correct") === "true"

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          fontFamily: "sans-serif",
          color: "white",
          padding: "60px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <span style={{ fontSize: "48px" }}>🐛</span>
          <span style={{ fontSize: "36px", fontWeight: "bold", color: "#4ade80" }}>
            BugHunt
          </span>
        </div>
        <h1
          style={{
            fontSize: "52px",
            fontWeight: "bold",
            textAlign: "center",
            margin: "0 0 16px",
          }}
        >
          Daily Challenge
        </h1>
        <p style={{ fontSize: "28px", color: "#94a3b8", margin: "0 0 32px" }}>{date}</p>
        {correct && (
          <div style={{ display: "flex", gap: "32px", marginBottom: "32px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "48px", fontWeight: "bold", color: "#4ade80" }}>
                {parseFloat(time) > 0 ? (parseFloat(time) / 1000).toFixed(1) + "s" : "✓"}
              </div>
              <div style={{ fontSize: "20px", color: "#64748b" }}>Time</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "48px", fontWeight: "bold", color: "#facc15" }}>
                #{rank}
              </div>
              <div style={{ fontSize: "20px", color: "#64748b" }}>Rank</div>
            </div>
          </div>
        )}
        {!correct && (
          <p style={{ fontSize: "32px", color: "#f87171", marginBottom: "32px" }}>
            Keep trying! 💪
          </p>
        )}
        <p style={{ fontSize: "20px", color: "#475569" }}>bughunt.vercel.app/daily</p>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
