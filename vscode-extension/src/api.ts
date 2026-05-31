const BASE_URL = "https://bughunt.vercel.app"

export interface Bug {
  bugId: string; language: string; category: string; difficulty: number
  buggyCode: string; options: string[]; explanation?: string; hint?: string
}

export async function fetchRandomBug(token: string, language?: string): Promise<Bug | null> {
  const url = `${BASE_URL}/api/bugs/random${language ? `?language=${language}` : ""}`
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } })
  if (!res.ok) return null
  return res.json()
}

export async function fetchDailyChallenge(token: string): Promise<{ bug: Bug; date: string } | null> {
  const res = await fetch(`${BASE_URL}/api/daily`, { headers: { "Authorization": `Bearer ${token}` } })
  if (!res.ok) return null
  const data = await res.json()
  return data.bug ? { bug: data.bug, date: data.date } : null
}
