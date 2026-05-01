const AO3_HOSTS = new Set(['archiveofourown.org', 'www.archiveofourown.org'])

type Ao3ChapterUrl = {
  kind: 'chapter'
  url: string
  workId: string
  chapterId: string
}

type Ao3WorkUrl = {
  kind: 'work'
  url: string
  workId: string
}

type Ao3SeriesUrl = {
  kind: 'series'
  url: string
  seriesId: string
}

export type ParsedAo3Url = Ao3ChapterUrl | Ao3WorkUrl | Ao3SeriesUrl

export function parseAo3Url(value: string): ParsedAo3Url | null {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  let url: URL
  try {
    url = new URL(trimmedValue)
  } catch {
    return null
  }

  if (!AO3_HOSTS.has(url.hostname)) {
    return null
  }

  const pathname = url.pathname.replace(/\/+$/, '')
  const chapterMatch = pathname.match(/^\/works\/(\d+)\/chapters\/(\d+)$/)
  if (chapterMatch) {
    return {
      kind: 'chapter',
      url: url.toString(),
      workId: chapterMatch[1],
      chapterId: chapterMatch[2],
    }
  }

  const workMatch = pathname.match(/^\/works\/(\d+)$/)
  if (workMatch) {
    return {
      kind: 'work',
      url: url.toString(),
      workId: workMatch[1],
    }
  }

  const seriesMatch = pathname.match(/^\/series\/(\d+)$/)
  if (seriesMatch) {
    return {
      kind: 'series',
      url: url.toString(),
      seriesId: seriesMatch[1],
    }
  }

  return null
}

export function getAo3WorkDraft(value: string) {
  const parsed = parseAo3Url(value)

  if (!parsed || parsed.kind === 'chapter') {
    return null
  }

  if (parsed.kind === 'work') {
    return {
      title: `AO3 Work ${parsed.workId}`,
      sourceType: 'ao3' as const,
      sourceId: `ao3:work:${parsed.workId}`,
      sourceMetadata: JSON.stringify({
        source: 'ao3',
        kind: 'work',
        work_id: parsed.workId,
        work_title: null,
        authors: [],
        url: parsed.url,
      }),
    }
  }

  return {
    title: `AO3 Series ${parsed.seriesId}`,
    sourceType: 'ao3' as const,
    sourceId: `ao3:series:${parsed.seriesId}`,
    sourceMetadata: JSON.stringify({
      source: 'ao3',
      kind: 'series',
      series_id: parsed.seriesId,
      series_title: null,
      url: parsed.url,
    }),
  }
}
