// src/app/(social)/org/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type OrgEntry = {
  orgId: string
  orgName: string
  joinedAt: number
}

export default function MyOrgsPage() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<OrgEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [joinCode, setJoinCode] = useState("")
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/org")
      .then((r) => r.json())
      .then((d) => {
        setOrgs(d.orgs ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    const res = await fetch("/api/org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? "Failed to create org")
      setCreating(false)
      return
    }
    router.push(`/org/${data.orgId}`)
  }

  async function handleJoin() {
    if (!joinCode.trim()) return
    setJoining(true)
    setError(null)
    const res = await fetch("/api/org/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode: joinCode.trim() }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? "Failed to join org")
      setJoining(false)
      return
    }
    router.push(`/org/${data.orgId}`)
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <p className="text-white/50">Loading...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-bold text-white">My Orgs</h1>

      {orgs.length === 0 ? (
        <p className="text-sm text-white/40">You are not a member of any org yet.</p>
      ) : (
        <div className="space-y-3">
          {orgs.map((o) => (
            <Card key={o.orgId} className="border-white/10 bg-white/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-white">{o.orgName}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/org/${o.orgId}`}>View</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Create org */}
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
            Create Org
          </h2>
          <div className="space-y-2">
            <Label htmlFor="org-name" className="text-white/70">
              Org Name
            </Label>
            <Input
              id="org-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Acme Corp"
              className="bg-white/5 text-white"
            />
          </div>
          <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="w-full">
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>

        {/* Join org */}
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
            Join Org
          </h2>
          <div className="space-y-2">
            <Label htmlFor="invite-code" className="text-white/70">
              Invite Code
            </Label>
            <Input
              id="invite-code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABCD1234"
              maxLength={8}
              className="bg-white/5 font-mono text-white"
            />
          </div>
          <Button onClick={handleJoin} disabled={joining || !joinCode.trim()} variant="outline" className="w-full">
            {joining ? "Joining..." : "Join"}
          </Button>
        </div>
      </div>
    </div>
  )
}
