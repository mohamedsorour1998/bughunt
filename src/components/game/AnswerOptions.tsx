"use client"

import { cn } from "@/lib/utils"

interface AnswerOptionsProps {
  options: [string, string, string, string]
  selectedAnswer?: number
  correctAnswer?: number
  revealed?: boolean
  disabled?: boolean
  onAnswer: (index: number) => void
}

const LABELS = ["A", "B", "C", "D"] as const

export function AnswerOptions({
  options,
  selectedAnswer,
  correctAnswer,
  revealed = false,
  disabled = false,
  onAnswer,
}: AnswerOptionsProps) {
  function getButtonStyles(index: number): string {
    const isSelected = selectedAnswer === index
    const isCorrect = correctAnswer === index

    if (revealed) {
      if (isCorrect) {
        return "bg-green-900/50 border-green-500 text-green-100 cursor-default"
      }
      if (isSelected && !isCorrect) {
        return "bg-red-900/50 border-red-500 text-red-100 cursor-default"
      }
      return "border-white/10 text-white/30 cursor-default"
    }

    if (isSelected) {
      return "border-blue-500 bg-blue-900/40 text-white"
    }

    return cn(
      "border-white/10 bg-white/5 text-white/90",
      !disabled && "hover:border-white/30 hover:bg-white/10 cursor-pointer",
      disabled && "cursor-not-allowed"
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((option, index) => (
        <button
          key={index}
          type="button"
          disabled={disabled || revealed}
          onClick={() => {
            if (!disabled && !revealed) {
              onAnswer(index)
            }
          }}
          className={cn(
            "flex items-start gap-3 rounded-xl border p-4 text-left text-sm transition-colors",
            getButtonStyles(index)
          )}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-current font-mono text-xs font-bold">
            {LABELS[index]}
          </span>
          <span className="leading-snug">{option}</span>
        </button>
      ))}
    </div>
  )
}
