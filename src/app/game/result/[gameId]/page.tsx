export default async function ResultPage({
  params,
}: {
  params: Promise<{ gameId: string }>
}) {
  const { gameId } = await params
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-white/60">Game result for {gameId}</div>
    </main>
  )
}
