import { ImageResponse } from "@vercel/og"

export const runtime = "edge"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const outcomeParam = searchParams.get("outcome")
  const outcome = outcomeParam === "loss" ? "DEFEAT" : outcomeParam === "draw" ? "DRAW" : "VICTORY"
  const name = (searchParams.get("name") ?? "A bug hunter").slice(0, 24)
  const elo = (searchParams.get("elo") ?? "1200").slice(0, 5)
  const accent = outcome === "VICTORY" ? "#34d399" : outcome === "DEFEAT" ? "#f87171" : "#9ca3af"

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#030712",
          color: "white",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", fontSize: 36, color: "#34d399", marginBottom: 24 }}>🐛 BugHunt</div>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 800, color: accent }}>{outcome}</div>
        <div style={{ display: "flex", fontSize: 40, marginTop: 24 }}>{name}</div>
        <div style={{ display: "flex", fontSize: 32, color: "#9ca3af", marginTop: 12 }}>{elo} Elo</div>
        <div style={{ display: "flex", fontSize: 24, color: "#6b7280", marginTop: 40 }}>
          Race to find bugs faster than anyone — bughunt.vercel.app
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
