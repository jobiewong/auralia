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

export function useElapsedSecondsFromTimestamp(startedAt: string | null) {
  return useElapsedSeconds(startedAt ? parseSqliteTimestamp(startedAt) : null)
}

export function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (minutes === 0) {
    return `${remainingSeconds}s`
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`
}

export function diffSeconds(start: string, end: string) {
  const startedAt = parseSqliteTimestamp(start)
  const completedAt = parseSqliteTimestamp(end)

  if (startedAt === null || completedAt === null) {
    return 0
  }

  return Math.max(0, Math.floor((completedAt - startedAt) / 1000))
}

export function parseSqliteTimestamp(value: string) {
  const parsed = value.includes('T')
    ? new Date(value)
    : new Date(`${value.replace(' ', 'T')}Z`)
  const time = parsed.getTime()

  return Number.isNaN(time) ? null : time
}
