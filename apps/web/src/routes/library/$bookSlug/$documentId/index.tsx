import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Play } from '~/components/icons/play'
import { ProgressArc } from '~/components/ui/progress-arc'

import { Button } from '~/components/ui/button'
import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import { formatElapsed, useElapsedSeconds } from '~/hooks/use-elapsed-seconds'
import {
  runAttribution,
  runCastDetection,
  runSegmentation,
} from '~/lib/pipeline-api'
import {
  countReviewSpans,
  formatDate,
  formatJsonSummary,
  formatMetric,
} from '~/lib/utils'

export const Route = createFileRoute('/library/$bookSlug/$documentId/')({
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const queryClient = useQueryClient()
  const spans = useDocumentSpans(bookSlug, documentId)
  const diagnostics = useDocumentDiagnostics(bookSlug, documentId)
  const reviewCount = countReviewSpans(spans)
  const [runningStage, setRunningStage] = useState<
    'segmentation' | 'cast detection' | 'attribution' | null
  >(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const elapsed = useElapsedSeconds(startedAt)
  const hasCompletedSegmentation =
    diagnostics?.latestSegmentationJob?.status === 'completed' ||
    (diagnostics?.spanCounts.total ?? 0) > 0 ||
    spans.length > 0
  const hasCompletedAttribution =
    diagnostics?.latestAttributionJob?.status === 'completed'
  const hasCompletedCastDetection =
    diagnostics?.latestCastDetectionJob?.status === 'completed' ||
    (diagnostics?.castCounts.total ?? 0) > 0
  const canRunCastDetection = hasCompletedSegmentation && runningStage === null
  const canRunAttribution =
    hasCompletedSegmentation && hasCompletedCastDetection && runningStage === null

  async function refreshDocumentState() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['document-spans', bookSlug, documentId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['document-diagnostics', bookSlug, documentId],
      }),
      queryClient.invalidateQueries({ queryKey: ['book-documents', bookSlug] }),
      queryClient.invalidateQueries({ queryKey: ['books'] }),
    ])
  }

  async function handleRunSegmentation() {
    setRunningStage('segmentation')
    setStartedAt(Date.now())
    setError(null)

    try {
      await runSegmentation(documentId)
      await refreshDocumentState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Segmentation failed')
    } finally {
      setRunningStage(null)
      setStartedAt(null)
    }
  }

  async function handleRunAttribution() {
    if (!hasCompletedSegmentation) {
      setError('Run segmentation before attribution.')
      return
    }
    if (!hasCompletedCastDetection) {
      setError('Run cast detection before attribution.')
      return
    }

    setRunningStage('attribution')
    setStartedAt(Date.now())
    setError(null)

    try {
      await runAttribution(documentId)
      await refreshDocumentState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attribution failed')
    } finally {
      setRunningStage(null)
      setStartedAt(null)
    }
  }

  async function handleRunCastDetection() {
    if (!hasCompletedSegmentation) {
      setError('Run segmentation before cast detection.')
      return
    }

    setRunningStage('cast detection')
    setStartedAt(Date.now())
    setError(null)

    try {
      await runCastDetection(documentId)
      await refreshDocumentState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cast detection failed')
    } finally {
      setRunningStage(null)
      setStartedAt(null)
    }
  }

  return (
    <div className="grid gap-12">
      <section className="flex flex-col gap-8">
        <div>
          <h2 className="mb-5 font-serif text-3xl">Status</h2>
          <ol className="space-y-2 font-serif">
            <PipelineStage
              label="Ingested"
              status="complete"
              detail="document stored"
            />
            <PipelineStage
              label="Segmented"
              status={diagnostics?.latestSegmentationJob?.status ?? 'missing'}
              detail="span data available on Text"
            />
            <PipelineStage
              label="Cast"
              status={diagnostics?.latestCastDetectionJob?.status ?? 'missing'}
              detail={
                diagnostics?.castCounts.total ? (
                  <Link
                    to="/library/$bookSlug/$documentId/cast"
                    params={{ bookSlug, documentId }}
                    className="hover:underline"
                  >
                    {formatMetric(diagnostics.castCounts.total, 'cast members')}
                  </Link>
                ) : (
                  'speaker cast available on Cast'
                )
              }
            />
            <PipelineStage
              label="Attributed"
              status={diagnostics?.latestAttributionJob?.status ?? 'missing'}
              detail="speaker data available on Text"
            />
            <PipelineStage
              label="Review"
              status={reviewCount > 0 ? 'needs review' : 'clear'}
              detail={
                reviewCount > 0 ? (
                  <Link
                    to="/library/$bookSlug/$documentId/text"
                    params={{ bookSlug, documentId }}
                    className="hover:underline"
                  >
                    {formatMetric(reviewCount, 'needs review')} on Text
                  </Link>
                ) : (
                  'no review flags'
                )
              }
            />
          </ol>
          <div className="mt-8 grid gap-4 border-t py-5 font-serif">
            <div className="flex flex-wrap items-center gap-4">
              <Button
                type="button"
                size="lg"
                disabled={runningStage !== null || hasCompletedSegmentation}
                onClick={handleRunSegmentation}
                className="min-w-52"
              >
                <Play className="size-5" />
                {hasCompletedSegmentation ? 'Segmented' : 'Run Segmentation'}
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={!canRunCastDetection || hasCompletedCastDetection}
                onClick={handleRunCastDetection}
                className="min-w-52"
              >
                <Play className="size-5" />
                {hasCompletedCastDetection ? 'Cast Detected' : 'Detect Cast'}
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={!canRunAttribution || hasCompletedAttribution}
                onClick={handleRunAttribution}
                className="min-w-52"
              >
                <Play className="size-5" />
                {hasCompletedAttribution ? 'Attributed' : 'Run Attribution'}
              </Button>
              {runningStage ? (
                <p className="flex items-center gap-2 text-lg text-foreground/60">
                  <ProgressArc className="size-5" />
                  {runningStage} running for {formatElapsed(elapsed)}
                </p>
              ) : null}
            </div>
            {!hasCompletedSegmentation ? (
              <p className="text-foreground/60">
                Cast detection unlocks after segmentation has completed.
              </p>
            ) : null}
            {hasCompletedSegmentation && !hasCompletedCastDetection ? (
              <p className="text-foreground/60">
                Attribution unlocks after cast detection has completed.
              </p>
            ) : null}
            {error ? (
              <p className="text-orange-950" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <JobSummary
          title="Segmentation Job"
          job={diagnostics?.latestSegmentationJob ?? null}
        />
        <JobSummary
          title="Cast Detection Job"
          job={diagnostics?.latestCastDetectionJob ?? null}
        />
        <JobSummary
          title="Attribution Job"
          job={diagnostics?.latestAttributionJob ?? null}
        />
      </section>
    </div>
  )
}

function PipelineStage({
  label,
  status,
  detail,
}: {
  label: string
  status: string
  detail: ReactNode
}) {
  return (
    <li className="grid gap-2 sm:grid-cols-[10rem_9rem_1fr]">
      <p>{label}</p>
      <p className="text-foreground/50">{status}</p>
      <p className="text-foreground/50">{detail}</p>
    </li>
  )
}

function JobSummary({
  title,
  job,
}: {
  title: string
  job: {
    id: string
    status: string
    modelName?: string | null
    stats?: string | null
    errorReport?: string | null
    completedAt?: string | null
    createdAt: string
    updatedAt: string
  } | null
}) {
  const duration =
    job?.completedAt && job.createdAt
      ? formatElapsed(diffSeconds(job.createdAt, job.completedAt))
      : null

  return (
    <section className="font-serif">
      <h2 className="mb-5 text-3xl">{title}</h2>
      {!job ? (
        <p className="text-foreground/50">No job recorded.</p>
      ) : (
        <dl className="grid gap-2 border-t py-5 sm:grid-cols-[9rem_1fr]">
          <dt className="text-foreground/50">Status</dt>
          <dd>{job.status}</dd>
          <dt className="text-foreground/50">Started</dt>
          <dd>{formatDate(job.createdAt)}</dd>
          <dt className="text-foreground/50">Completed</dt>
          <dd>{job.completedAt ? formatDate(job.completedAt) : 'not complete'}</dd>
          <dt className="text-foreground/50">Duration</dt>
          <dd>{duration ?? 'not complete'}</dd>
          <dt className="text-foreground/50">Updated</dt>
          <dd>{formatDate(job.updatedAt)}</dd>
          <dt className="text-foreground/50">Model</dt>
          <dd>{job.modelName || 'none'}</dd>
          <dt className="text-foreground/50">Stats</dt>
          <dd>{formatJsonSummary(job.stats)}</dd>
          <dt className="text-foreground/50">Error</dt>
          <dd>{formatJsonSummary(job.errorReport)}</dd>
        </dl>
      )}
    </section>
  )
}

function diffSeconds(start: string, end: string) {
  const startedAt = parseSqliteTimestamp(start).getTime()
  const completedAt = parseSqliteTimestamp(end).getTime()

  if (Number.isNaN(startedAt) || Number.isNaN(completedAt)) {
    return 0
  }

  return Math.max(0, Math.floor((completedAt - startedAt) / 1000))
}

function parseSqliteTimestamp(value: string) {
  if (value.includes('T')) {
    return new Date(value)
  }
  return new Date(`${value.replace(' ', 'T')}Z`)
}
