"use client"

type EloPoint = {
  eloAfter: number
  createdAt: number
}

type EloChartProps = {
  history: EloPoint[]
  currentElo: number
}

const VIEWBOX_WIDTH = 400
const VIEWBOX_HEIGHT = 120
const PADDING_X = 40
const PADDING_Y = 15
const BASELINE_ELO = 1200

export function EloChart({ history, currentElo }: EloChartProps) {
  // Take last 20 points
  const points = history.slice(-20)

  if (points.length < 2) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-white/50">
        Play more games to see your Elo trend
      </div>
    )
  }

  const elos = points.map((p) => p.eloAfter).filter((v) => Number.isFinite(v))

  if (elos.length < 2) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-white/50">
        Play more games to see your Elo trend
      </div>
    )
  }

  const minElo = Math.min(...elos, BASELINE_ELO) - 20
  const maxElo = Math.max(...elos, currentElo) + 20

  const eloRange = maxElo - minElo || 1

  function xPos(index: number): number {
    return PADDING_X + (index / (points.length - 1)) * (VIEWBOX_WIDTH - 2 * PADDING_X)
  }

  function yPos(elo: number): number {
    return PADDING_Y + (1 - (elo - minElo) / eloRange) * (VIEWBOX_HEIGHT - 2 * PADDING_Y)
  }

  // Build SVG path
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xPos(i).toFixed(1)} ${yPos(p.eloAfter).toFixed(1)}`)
    .join(" ")

  // Trending up or down
  const firstElo = points[0].eloAfter
  const lastElo = points[points.length - 1].eloAfter
  const trendColor = lastElo >= firstElo ? "#22c55e" : "#ef4444"

  // Baseline reference line y
  const baselineY = yPos(BASELINE_ELO)
  const showBaseline = baselineY >= PADDING_Y && baselineY <= VIEWBOX_HEIGHT - PADDING_Y

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      style={{ width: "100%", height: "auto" }}
      aria-label="Elo progression chart"
      role="img"
    >
      {/* Background */}
      <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} rx={8} fill="rgba(255,255,255,0.03)" />

      {/* Baseline reference line at 1200 */}
      {showBaseline && (
        <line
          x1={PADDING_X}
          y1={baselineY}
          x2={VIEWBOX_WIDTH - PADDING_X}
          y2={baselineY}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}

      {/* Y-axis labels */}
      <text
        x={PADDING_X - 4}
        y={PADDING_Y + 4}
        textAnchor="end"
        fill="rgba(255,255,255,0.4)"
        fontSize={9}
      >
        {maxElo - 20}
      </text>
      <text
        x={PADDING_X - 4}
        y={VIEWBOX_HEIGHT - PADDING_Y}
        textAnchor="end"
        fill="rgba(255,255,255,0.4)"
        fontSize={9}
      >
        {minElo + 20}
      </text>

      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke={trendColor}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data point circles */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xPos(i)}
          cy={yPos(p.eloAfter)}
          r={2.5}
          fill={trendColor}
          opacity={0.8}
        />
      ))}
    </svg>
  )
}
