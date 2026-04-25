import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Play } from '~/components/icons/play'
import { ProgressArc } from '~/components/ui/progress-arc'

import { Button } from '~/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import { formatElapsed, useElapsedSeconds } from '~/hooks/use-elapsed-seconds'
import {
  runAttribution,
  runCastDetection,
  runSegmentation,
} from '~/lib/pipeline-api'
import {
  cn,
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
    hasCompletedSegmentation &&
    hasCompletedCastDetection &&
    runningStage === null

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
        <div className="">
          <h2 className="mb-5 font-serif text-3xl">Status</h2>
          <ol className="flex flex-col font-serif border-t pt-5">
            <PipelineStage
              label="Ingestion"
              status="completed"
              detail="document stored"
              action={
                <Button
                  type="button"
                  size="lg"
                  disabled={true}
                  className="w-52 opacity-50"
                >
                  <Play className="size-5" />
                  Replace Source
                </Button>
              }
            />
            <PipelineStage
              label="Segmentation"
              status={diagnostics?.latestSegmentationJob?.status ?? 'missing'}
              detail={
                <Link
                  to="/library/$bookSlug/$documentId/text"
                  params={{ bookSlug, documentId }}
                  className="hover:underline"
                >
                  span data available
                </Link>
              }
              diagnostics={diagnostics?.latestSegmentationJob}
              action={
                <Button
                  type="button"
                  size="lg"
                  disabled={runningStage !== null || hasCompletedSegmentation}
                  onClick={handleRunSegmentation}
                  className="w-52"
                >
                  <Play className="size-5" />
                  {hasCompletedSegmentation ? 'Segmented' : 'Run Segmentation'}
                </Button>
              }
            />
            <PipelineStage
              label="Cast Detection"
              status={diagnostics?.latestCastDetectionJob?.status ?? 'missing'}
              detail={
                <Link
                  to="/library/$bookSlug/$documentId/cast"
                  params={{ bookSlug, documentId }}
                  className="hover:underline"
                >
                  {diagnostics?.castCounts.total
                    ? formatMetric(diagnostics.castCounts.total, 'cast members')
                    : 'speaker cast available on Cast'}
                </Link>
              }
              diagnostics={diagnostics?.latestCastDetectionJob}
              action={
                <Button
                  type="button"
                  size="lg"
                  disabled={!canRunCastDetection || hasCompletedCastDetection}
                  onClick={handleRunCastDetection}
                  className="w-52"
                >
                  <Play className="size-5" />
                  {hasCompletedCastDetection ? 'Cast Detected' : 'Detect Cast'}
                </Button>
              }
            />
            <PipelineStage
              label="Attribution"
              status={diagnostics?.latestAttributionJob?.status ?? 'missing'}
              detail={
                <Link
                  to="/library/$bookSlug/$documentId/text"
                  params={{ bookSlug, documentId }}
                  className="hover:underline"
                >
                  {reviewCount > 0
                    ? formatMetric(reviewCount, 'needs review')
                    : 'speaker data available'}
                </Link>
              }
              diagnostics={diagnostics?.latestAttributionJob}
              action={
                <Button
                  type="button"
                  size="lg"
                  disabled={!canRunAttribution || hasCompletedAttribution}
                  onClick={handleRunAttribution}
                  className="w-52"
                >
                  <Play className="size-5" />
                  {hasCompletedAttribution ? 'Attributed' : 'Run Attribution'}
                </Button>
              }
            />
            <PipelineStage
              label="Synthesis"
              status={'not implemented'}
              detail={null}
            />
          </ol>
        </div>
      </section>
    </div>
  )
}

function PipelineStage({
  label,
  status,
  detail,
  diagnostics,
  action,
}: {
  label: string
  status: string
  detail: ReactNode
  diagnostics?: {
    id: string
    status: string
    modelName?: string | null
    stats?: string | null
    errorReport?: string | null
    completedAt?: string | null
    createdAt: string
    updatedAt: string
  } | null
  action?: ReactNode
}) {
  return (
    <li className="grid grid-cols-[4rem_1fr]">
      <div className="relative flex justify-center">
        <div className="h-full w-px bg-foreground" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background grid place-content-center p-0.5 border-foreground">
          <motion.div
            animate={{
              scale: status === 'completed' ? 1 : 0,
            }}
            className="size-3 bg-foreground rounded-full"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 mb-8">
        <div>
          <Tooltip>
            <p>{label}</p>
            <TooltipTrigger asChild>
              <p
                className={cn(
                  'cursor-help w-fit',
                  !diagnostics && 'cursor-default',
                )}
              >
                <span className="uppercase opacity-70">{status}</span>
                <span className="text-foreground/40 ml-2">-- {detail}</span>
              </p>
            </TooltipTrigger>
            {diagnostics ? (
              <TooltipContent>
                <JobSummary title={label} job={diagnostics} />
              </TooltipContent>
            ) : null}
          </Tooltip>
        </div>
        {action ?? null}
      </div>
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
    <div className="font-serif">
      <h2 className="mb-2 border-b pb-2 border-orange-500 -mx-3 px-3 text-3xl">
        {title}
      </h2>
      {!job ? (
        <p className="text-orange-500/50">No job recorded.</p>
      ) : (
        <dl className="grid gap-2 border-t py-5 sm:grid-cols-[9rem_1fr]">
          <dt className="text-orange-500/50">Status</dt>
          <dd>{job.status}</dd>
          <dt className="text-orange-500/50">Started</dt>
          <dd>{formatDate(job.createdAt)}</dd>
          <dt className="text-orange-500/50">Completed</dt>
          <dd>
            {job.completedAt ? formatDate(job.completedAt) : 'not complete'}
          </dd>
          <dt className="text-orange-500/50">Duration</dt>
          <dd>{duration ?? 'not complete'}</dd>
          <dt className="text-orange-500/50">Updated</dt>
          <dd>{formatDate(job.updatedAt)}</dd>
          <dt className="text-orange-500/50">Model</dt>
          <dd>{job.modelName || 'none'}</dd>
          <dt className="text-orange-500/50">Stats</dt>
          <dd>{formatJsonSummary(job.stats)}</dd>
          <dt className="text-orange-500/50">Error</dt>
          <dd>{formatJsonSummary(job.errorReport)}</dd>
        </dl>
      )}
    </div>
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
