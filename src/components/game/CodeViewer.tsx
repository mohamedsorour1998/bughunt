"use client"

import { Highlight, themes } from "prism-react-renderer"
import { useState, useCallback } from "react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FontSize = "xs" | "sm" | "base"
type WrapMode = "wrap" | "scroll"

interface CodeViewerProps {
  code: string
  language: string
  bugLine?: number
  revealed?: boolean
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FONT_SIZE_CLASSES: Record<FontSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
}

const FONT_SIZE_LABELS: Record<FontSize, string> = {
  xs: "XS",
  sm: "SM",
  base: "LG",
}

const FONT_SIZE_CYCLE: FontSize[] = ["xs", "sm", "base"]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeViewer({
  code,
  language,
  bugLine,
  revealed = false,
  className,
}: CodeViewerProps) {
  // Default to xs on mobile (client-side preference persists within page session)
  const [fontSize, setFontSize] = useState<FontSize>("xs")
  const [wrapMode, setWrapMode] = useState<WrapMode>("scroll")
  const [copied, setCopied] = useState(false)

  function cycleFont() {
    setFontSize((prev) => {
      const idx = FONT_SIZE_CYCLE.indexOf(prev)
      return FONT_SIZE_CYCLE[(idx + 1) % FONT_SIZE_CYCLE.length]
    })
  }

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard not available (e.g. non-https)
    }
  }, [code])

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-white/10 bg-[#011627] font-mono",
        FONT_SIZE_CLASSES[fontSize],
        className
      )}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Toolbar                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-white/40">
          {language}
        </span>
        <div className="flex items-center gap-1">
          {/* Wrap toggle */}
          <button
            onClick={() => setWrapMode((m) => (m === "scroll" ? "wrap" : "scroll"))}
            className="rounded px-2 py-0.5 text-xs text-white/40 hover:bg-white/10 hover:text-white transition-colors"
            title={wrapMode === "scroll" ? "Switch to wrap mode" : "Switch to scroll mode"}
          >
            {wrapMode === "scroll" ? "↔ Scroll" : "↩ Wrap"}
          </button>
          {/* Font size cycle */}
          <button
            onClick={cycleFont}
            className="rounded px-2 py-0.5 text-xs text-white/40 hover:bg-white/10 hover:text-white transition-colors"
            title="Toggle font size"
          >
            {FONT_SIZE_LABELS[fontSize]}
          </button>
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="rounded px-2 py-0.5 text-xs text-white/40 hover:bg-white/10 hover:text-white transition-colors"
            title="Copy code"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Code block                                                           */}
      {/* Touch-action: auto allows native pinch-to-zoom on mobile            */}
      {/* ------------------------------------------------------------------ */}
      <Highlight theme={themes.nightOwl} code={code} language={language}>
        {({ className: hlClass, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(
              hlClass,
              "p-3",
              wrapMode === "scroll" ? "overflow-x-auto" : "overflow-x-hidden"
            )}
            style={{
              ...style,
              background: "transparent",
              margin: 0,
              touchAction: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {tokens.map((line, i) => {
              const lineNumber = i + 1
              const isHighlighted = revealed && bugLine === lineNumber
              const lineProps = getLineProps({ line })

              return (
                <div
                  key={i}
                  {...lineProps}
                  className={cn(
                    lineProps.className,
                    "flex min-w-full py-[1px]",
                    isHighlighted
                      ? "border-l-4 border-red-500 pl-2"
                      : "pl-[6px]",  // visually align non-highlighted lines
                    wrapMode === "wrap" ? "flex-wrap" : ""
                  )}
                >
                  {/* Line numbers: hidden below 480px via max-sm: */}
                  <span className="mr-3 w-6 shrink-0 select-none text-right text-white/30 max-[480px]:hidden">
                    {lineNumber}
                  </span>
                  <span className={cn("flex-1", wrapMode === "wrap" ? "whitespace-pre-wrap break-all" : "")}>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </span>
                </div>
              )
            })}
          </pre>
        )}
      </Highlight>
    </div>
  )
}
