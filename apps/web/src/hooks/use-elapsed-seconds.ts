import { useEffect, useState } from 'react'

export function useElapsedSeconds(startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt === null) {
      return
    }

    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 250)

    return () => window.clearInterval(interval)
  }, [startedAt])

  if (startedAt === null) {
    return 0
  }

  return Math.max(0, Math.floor((now - startedAt) / 1000))
}

export function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (minutes === 0) {
    return `${remainingSeconds}s`
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`
}
