import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function parseWorkSourceMetadata(sourceMetadata: string | null) {
  if (sourceMetadata === null) {
    return null
  }
  const json = JSON.parse(sourceMetadata) as {
    source: string
    work_id: string
    work_title: string
    authors: { name: string; url: string }[]
  }
  return json
}

export function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatTextLength(textLength: number) {
  return `${new Intl.NumberFormat('en-GB').format(textLength)} chars`
}

export function formatSpanCount(spanCount: number) {
  const label = spanCount === 1 ? 'span' : 'spans'
  return `${new Intl.NumberFormat('en-GB').format(spanCount)} ${label}`
}

export function formatCount(count: number, label: string) {
  const pluralized = count === 1 ? label : `${label}s`
  return `${new Intl.NumberFormat('en-GB').format(count)} ${pluralized}`
}

export function formatMetric(count: number, label: string) {
  return `${new Intl.NumberFormat('en-GB').format(count)} ${label}`
}

export function formatConfidence(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'no confidence'
  }
  return `${Math.round(value * 100)}% confidence`
}

export function formatJsonSummary(value: string | null | undefined) {
  if (!value) {
    return 'none'
  }
  const parsed = parseJson(value)
  if (!parsed) {
    return value
  }
  if (Array.isArray(parsed)) {
    return `${parsed.length} items`
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return String(parsed)
  }
  return Object.entries(parsed)
    .slice(0, 5)
    .map(([key, item]) => `${key}: ${formatJsonValue(item)}`)
    .join(' / ')
}

export function parseJson(value: string | null | undefined): unknown {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function parseRoster(value: string | null | undefined) {
  const parsed = parseJson(value)
  const roster = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && 'characters' in parsed
      ? (parsed as { characters?: unknown }).characters
      : null

  if (!Array.isArray(roster)) {
    return []
  }

  return roster.flatMap((character) => {
    if (typeof character !== 'object' || character === null) {
      return []
    }
    const record = character as Record<string, unknown>
    const canonicalName =
      typeof record.canonical_name === 'string'
        ? record.canonical_name
        : typeof record.canonicalName === 'string'
          ? record.canonicalName
          : null
    if (!canonicalName) {
      return []
    }
    return [
      {
        canonicalName,
        aliases: Array.isArray(record.aliases)
          ? record.aliases.filter(
              (alias): alias is string => typeof alias === 'string',
            )
          : [],
        descriptor:
          typeof record.descriptor === 'string' ? record.descriptor : null,
      },
    ]
  })
}

export function getSpeakerCounts(
  spans: Array<{ speaker: string | null; type: 'narration' | 'dialogue' }>,
) {
  const counts = new Map<string, number>()
  for (const span of spans) {
    if (span.type === 'dialogue' && span.speaker) {
      counts.set(span.speaker, (counts.get(span.speaker) ?? 0) + 1)
    }
  }
  return counts
}

export function countByType(
  spans: Array<{ type: 'narration' | 'dialogue' }>,
  type: 'narration' | 'dialogue',
) {
  return spans.filter((span) => span.type === type).length
}

export function countAttributed(spans: Array<{ speaker: string | null }>) {
  return spans.filter((span) => span.speaker).length
}

export function countNeedsReview(
  spans: Array<{ needsReview: boolean | null }>,
) {
  return spans.filter((span) => span.needsReview).length
}

export function countUnknown(spans: Array<{ speaker: string | null }>) {
  return spans.filter((span) => span.speaker === 'UNKNOWN').length
}

function formatJsonValue(value: unknown) {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'object') {
    return Array.isArray(value) ? `${value.length} items` : 'object'
  }
  return String(value)
}
