import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Pause } from '~/components/icons/pause'
import { Play } from '~/components/icons/play'
import { JobTimer } from '~/components/job-timer'
import { LoadingEllipsis } from '~/components/loading-ellipsis'
import type { DocumentSpan } from '~/db-collections'
import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import { cn, formatMetric, formatSpanCount } from '~/lib/utils'

export const Route = createFileRoute(
  '/library/$bookSlug/$documentId/synthesis',
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const queryClient = useQueryClient()
  const spans = useDocumentSpans(bookSlug, documentId)
  const { diagnostics } = useDocumentDiagnostics(bookSlug, documentId)
  const latestSynthesisJob = diagnostics?.latestSynthesisJob
  const previousSynthesisStatusRef = useRef<string | null>(null)
  const synthesisCounts = diagnostics?.synthesisCounts
  const currentSpanId =
    typeof synthesisCounts?.currentSpanId === 'string'
      ? synthesisCounts.currentSpanId
      : null
  const completedSpans =
    synthesisCounts?.completedSpans ??
    spans.filter((span) => span.synthesisStatus === 'completed').length
  const totalSpans = synthesisCounts?.totalSpans ?? spans.length
  const requiredVoiceCount = getRequiredVoiceCount(spans)
  const outputUrl =
    typeof latestSynthesisJob?.outputUrl === 'string'
      ? latestSynthesisJob.outputUrl
      : null
  const manifestUrl =
    typeof latestSynthesisJob?.manifestUrl === 'string'
      ? latestSynthesisJob.manifestUrl
      : null

  useEffect(() => {
    if (latestSynthesisJob?.status !== 'running') {
      void queryClient.invalidateQueries({
        queryKey: ['document-spans', bookSlug, documentId],
      })
      return
    }
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: ['document-spans', bookSlug, documentId],
      })
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [bookSlug, documentId, latestSynthesisJob?.status, queryClient])

  useEffect(() => {
    if (latestSynthesisJob?.status !== 'running' || !currentSpanId) {
      return
    }
    const currentSpanElement = document.getElementById(
      synthesisSpanElementId(currentSpanId),
    )
    if (!currentSpanElement) {
      return
    }
    scrollElementIntoComfortView(currentSpanElement)
  }, [currentSpanId, latestSynthesisJob?.status])

  useEffect(() => {
    const nextStatus = latestSynthesisJob?.status ?? null
    if (
      previousSynthesisStatusRef.current === 'running' &&
      nextStatus === 'completed'
    ) {
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    }
    previousSynthesisStatusRef.current = nextStatus
  }, [latestSynthesisJob?.status])

  return (
    <div className="grid gap-10">
      <section className="font-serif">
        <h2 className="mb-5 text-3xl">Synthesis</h2>
        <dl className="grid w-full gap-2 border-y py-5 sm:grid-cols-[12rem_1fr]">
          <dt className="text-foreground/50">Status</dt>
          <dd>
            {latestSynthesisJob?.status === 'running' ? (
              <JobTimer job={latestSynthesisJob} />
            ) : latestSynthesisJob?.status === 'completed' ? (
              'completed'
            ) : latestSynthesisJob?.status === 'failed' ? (
              'failed'
            ) : (
              'missing'
            )}
          </dd>
          <dt className="text-foreground/50">Input</dt>
          <dd>
            {formatSpanCount(spans.length)} spans,{' '}
            {formatMetric(requiredVoiceCount, 'voices')}
          </dd>
          <dt className="text-foreground/50">Output</dt>
          <dd className="flex flex-wrap gap-x-4 gap-y-1">
            {outputUrl ? (
              <a className="hover:underline" href={outputUrl}>
                output.wav
              </a>
            ) : (
              <span className="text-foreground/50">not generated</span>
            )}
            {manifestUrl ? (
              <a
                className="text-foreground/50 hover:underline"
                href={manifestUrl}
              >
                manifest.json
              </a>
            ) : null}
          </dd>
        </dl>
      </section>

      <section className="flex flex-wrap items-center gap-4 font-serif sticky -mx-2 px-2 py-1 top-4 bg-background">
        {latestSynthesisJob?.status === 'running' ? (
          <LoadingEllipsis className="text-foreground/50">
            {formatProgress(completedSpans, totalSpans)} spans processed
          </LoadingEllipsis>
        ) : (
          <p className="text-foreground/50">
            {formatProgress(completedSpans, totalSpans)} spans processed
          </p>
        )}
      </section>

      <section>
        <ol className="-mx-2">
          {spans.map((span) => (
            <SpanItem
              key={span.id}
              span={span}
              isCurrent={currentSpanId === span.id}
            />
          ))}
        </ol>
      </section>
    </div>
  )
}

function SpanItem({
  span,
  isCurrent,
}: {
  span: DocumentSpan
  isCurrent: boolean
}) {
  const isCompleted = span.synthesisStatus === 'completed'
  const isProcessing = span.synthesisStatus === 'processing'
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  function playSpan() {
    if (!span.synthesisAudioUrl) {
      return
    }
    const nextUrl = new URL(span.synthesisAudioUrl, window.location.href).href
    const current = audioRef.current

    if (!current) {
      const audio = new Audio(nextUrl)
      audio.addEventListener('play', () => setIsPlaying(true))
      audio.addEventListener('pause', () => setIsPlaying(false))
      audio.addEventListener('ended', () => setIsPlaying(false))
      audio.addEventListener('error', () => setIsPlaying(false))
      audioRef.current = audio
      void audio.play()
      return
    }

    if (current.src !== nextUrl) {
      current.pause()
      const audio = new Audio(nextUrl)
      audio.addEventListener('play', () => setIsPlaying(true))
      audio.addEventListener('pause', () => setIsPlaying(false))
      audio.addEventListener('ended', () => setIsPlaying(false))
      audio.addEventListener('error', () => setIsPlaying(false))
      audioRef.current = audio
      void audio.play()
      return
    }

    if (current.paused) {
      void current.play()
    } else {
      current.pause()
    }
  }

  return (
    <div
      id={synthesisSpanElementId(span.id)}
      className={cn(
        'space-y-1 group px-2 py-1.5',
        isCompleted ? 'opacity-100 hover:bg-orange-950/5 ' : 'opacity-50',
        isProcessing && 'opacity-100 animate-pulse',
        isCurrent && 'scroll-mt-32 scroll-mb-32',
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!isCompleted}
          onClick={playSpan}
          className={cn(
            'shrink-0 h-[1em] opacity-0  transition-opacity flex items-center gap-2',
            isCompleted && 'group-hover:opacity-60 hover:opacity-100',
            isPlaying && 'opacity-100',
          )}
        >
          {isPlaying ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
          <p>{formatDuration(span.synthesisDurationMs)}</p>
        </button>
      </div>
      <p>{span.text}</p>
    </div>
  )
}

function synthesisSpanElementId(spanId: string) {
  return `synthesis-span-${spanId}`
}

function scrollElementIntoComfortView(element: HTMLElement) {
  const viewportHeight = window.innerHeight
  const comfortPadding = Math.min(Math.max(viewportHeight * 0.25, 120), 260)
  const rect = element.getBoundingClientRect()
  const topLimit = comfortPadding
  const bottomLimit = viewportHeight - comfortPadding

  if (rect.top >= topLimit && rect.bottom <= bottomLimit) {
    return
  }

  const targetTop =
    window.scrollY + rect.top - (viewportHeight - rect.height) / 2
  window.scrollTo({
    top: Math.max(0, targetTop),
    behavior: 'smooth',
  })
}

function getRequiredVoiceCount(spans: DocumentSpan[]) {
  const speakers = new Set<string>(['NARRATOR'])
  for (const span of spans) {
    if (
      span.type === 'dialogue' &&
      span.speaker &&
      span.speaker !== 'UNKNOWN'
    ) {
      speakers.add(span.speaker)
    }
  }
  return speakers.size
}

function formatProgress(completed: number, total: number) {
  return `${formatSpanCount(completed)}/${formatSpanCount(total)}`
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return '--:--'
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0',
  )}`
}
