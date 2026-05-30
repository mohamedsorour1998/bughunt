"use client"

import { Highlight, themes } from "prism-react-renderer"
import { cn } from "@/lib/utils"

interface CodeViewerProps {
  code: string
  language: string
  bugLine?: number
  revealed?: boolean
  className?: string
}

export function CodeViewer({
  code,
  language,
  bugLine,
  revealed = false,
  className,
}: CodeViewerProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-white/10 bg-[#011627] font-mono text-sm",
        className
      )}
    >
      <Highlight theme={themes.nightOwl} code={code} language={language}>
        {({ className: hlClass, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(hlClass, "overflow-x-auto p-4")}
            style={{ ...style, background: "transparent", margin: 0 }}
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
                    "flex min-w-full rounded px-2 py-[1px]",
                    isHighlighted && "bg-red-900/40"
                  )}
                >
                  <span className="mr-4 w-6 shrink-0 select-none text-right text-white/30">
                    {lineNumber}
                  </span>
                  <span className="flex-1">
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
