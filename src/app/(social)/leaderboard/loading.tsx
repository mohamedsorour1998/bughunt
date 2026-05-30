import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-6 w-64" />
      <div className="rounded-xl border border-white/10 overflow-hidden">
        {/* Header row */}
        <div className="flex gap-4 px-4 py-3 border-b border-white/10 bg-white/5">
          <Skeleton className="h-4 w-6" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ml-auto h-4 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
        {/* 10 data rows */}
        {[...Array(10)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-white/5 last:border-0">
            <Skeleton className="h-4 w-6" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="ml-auto h-4 w-12" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
