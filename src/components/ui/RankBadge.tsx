import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type RankBadgeProps = {
  rank: string
  elo?: number
  size?: "sm" | "md" | "lg"
}

const rankStyles: Record<string, { bg: string; text: string }> = {
  Bronze: { bg: "bg-amber-800", text: "text-amber-200" },
  Silver: { bg: "bg-gray-500", text: "text-gray-100" },
  Gold: { bg: "bg-yellow-600", text: "text-yellow-100" },
  Platinum: { bg: "bg-cyan-700", text: "text-cyan-100" },
  Diamond: { bg: "bg-blue-600", text: "text-blue-100" },
  Master: { bg: "bg-purple-700", text: "text-purple-100" },
  Grandmaster: { bg: "bg-red-700", text: "text-red-100" },
}

const sizeStyles: Record<string, string> = {
  sm: "text-xs px-1.5 py-0.5",
  md: "text-sm px-2.5 py-1",
  lg: "text-base px-3 py-1.5",
}

export function RankBadge({ rank, elo, size = "md" }: RankBadgeProps) {
  const style = rankStyles[rank] ?? { bg: "bg-gray-600", text: "text-gray-100" }
  const sizeClass = sizeStyles[size]

  return (
    <Badge
      className={cn(
        "border-0 font-semibold",
        style.bg,
        style.text,
        sizeClass
      )}
    >
      {rank}
      {elo !== undefined && (
        <span className="ml-1 opacity-80">({elo})</span>
      )}
    </Badge>
  )
}
