import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Play } from '~/components/icons/play'

import { Button } from '~/components/ui/button'
import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import {
  runAttribution,
  runCastDetection,
  runSegmentation,
} from '~/server/pipeline-api'
import {
  countReviewSpans,
  formatMetric,
} from '~/lib/utils'
import { PipelineRerunDialog } from './-components/pipeline-rerun-dialog'
import { PipelineStage } from './-components/pipeline-stage'

export const Route = createFileRoute('/library/$bookSlug/$documentId/')({
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const queryClient = useQueryClient()
  const spans = useDocumentSpans(bookSlug, documentId)
  const { diagnostics } = useDocumentDiagnostics(bookSlug, documentId)
  const reviewCount = countReviewSpans(spans)
  const [runningStage, setRunningStage] = useState<
    'segmentation' | 'cast detection' | 'attribution' | null
  >(null)
  const [confirmRerunStage, setConfirmRerunStage] = useState<
    'segmentation' | 'cast detection' | null
  >(null)
  const [runningStartedAt, setRunningStartedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activePipelineJob = getActivePipelineJob(diagnostics)
  const isPipelineBusy = runningStage !== null || activePipelineJob !== null
  const hasCompletedSegmentation =
    diagnostics?.latestSegmentationJob?.status === 'completed' ||
    (diagnostics?.spanCounts.total ?? 0) > 0 ||
    spans.length > 0
  const hasCompletedAttribution =
    diagnostics?.latestAttributionJob?.status === 'completed'
  const hasCompletedCastDetection =
    diagnostics?.latestCastDetectionJob?.status === 'completed'
  const canRunCastDetection = hasCompletedSegmentation && !isPipelineBusy
  const canRunAttribution =
    hasCompletedSegmentation && hasCompletedCastDetection && !isPipelineBusy

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

  async function handleRunSegmentation(options?: { force?: boolean }) {
    setRunningStage('segmentation')
    setRunningStartedAt(new Date().toISOString())
    setError(null)

    try {
      const request = runSegmentation(documentId, options)
      window.setTimeout(() => void refreshDocumentState(), 250)
      await request
      await refreshDocumentState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Segmentation failed')
    } finally {
      setRunningStage(null)
      setRunningStartedAt(null)
    }
  }

  async function handleRunAttribution(options?: { force?: boolean }) {
    if (!hasCompletedSegmentation) {
      setError('Run segmentation before attribution.')
      return
    }
    if (!hasCompletedCastDetection) {
      setError('Run cast detection before attribution.')
      return
    }

    setRunningStage('attribution')
    setRunningStartedAt(new Date().toISOString())
    setError(null)

    try {
      const request = runAttribution(documentId, options)
      window.setTimeout(() => void refreshDocumentState(), 250)
      await request
      await refreshDocumentState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attribution failed')
    } finally {
      setRunningStage(null)
      setRunningStartedAt(null)
    }
  }

  async function handleRunCastDetection(options?: { force?: boolean }) {
    if (!hasCompletedSegmentation) {
      setError('Run segmentation before cast detection.')
      return
    }

    setRunningStage('cast detection')
    setRunningStartedAt(new Date().toISOString())
    setError(null)

    try {
      const request = runCastDetection(documentId, { ...options, useLLM: true })
      window.setTimeout(() => void refreshDocumentState(), 250)
      await request
      await refreshDocumentState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cast detection failed')
    } finally {
      setRunningStage(null)
      setRunningStartedAt(null)
    }
  }

  async function handleConfirmRerun() {
    const stage = confirmRerunStage
    setConfirmRerunStage(null)
    if (stage === 'segmentation') {
      await handleRunSegmentation({ force: true })
    }
    if (stage === 'cast detection') {
      await handleRunCastDetection({ force: true })
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
              status={diagnostics?.latestIngestionJob?.status ?? 'completed'}
              detail="document stored"
              diagnostics={diagnostics?.latestIngestionJob}
              timerJob={getStageTimerJob({
                job: diagnostics?.latestIngestionJob,
                isLocallyRunning: false,
                runningStartedAt,
              })}
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
              status={getStageStatus({
                job: diagnostics?.latestSegmentationJob,
                fallbackStatus: 'missing',
                isLocallyRunning: runningStage === 'segmentation',
              })}
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
              timerJob={getStageTimerJob({
                job: diagnostics?.latestSegmentationJob,
                isLocallyRunning: runningStage === 'segmentation',
                runningStartedAt,
              })}
              action={
                <PipelineActionButton
                  completed={hasCompletedSegmentation}
                  disabled={isPipelineBusy}
                  isRunning={runningStage === 'segmentation'}
                  runLabel="Run Segmentation"
                  completedLabel="Segmented"
                  onRun={() => handleRunSegmentation()}
                  onRerun={() => setConfirmRerunStage('segmentation')}
                />
              }
            />
            <PipelineStage
              label="Cast Detection"
              status={getStageStatus({
                job: diagnostics?.latestCastDetectionJob,
                fallbackStatus: 'missing',
                isLocallyRunning: runningStage === 'cast detection',
              })}
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
              timerJob={getStageTimerJob({
                job: diagnostics?.latestCastDetectionJob,
                isLocallyRunning: runningStage === 'cast detection',
                runningStartedAt,
              })}
              action={
                <PipelineActionButton
                  completed={hasCompletedCastDetection}
                  disabled={!canRunCastDetection}
                  isRunning={runningStage === 'cast detection'}
                  runLabel="Detect Cast"
                  completedLabel="Cast Detected"
                  onRun={() => handleRunCastDetection()}
                  onRerun={() => setConfirmRerunStage('cast detection')}
                />
              }
            />
            <PipelineStage
              label="Attribution"
              status={getStageStatus({
                job: diagnostics?.latestAttributionJob,
                fallbackStatus: 'missing',
                isLocallyRunning: runningStage === 'attribution',
              })}
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
              timerJob={getStageTimerJob({
                job: diagnostics?.latestAttributionJob,
                isLocallyRunning: runningStage === 'attribution',
                runningStartedAt,
              })}
              action={
                <PipelineActionButton
                  completed={hasCompletedAttribution}
                  disabled={!canRunAttribution}
                  isRunning={runningStage === 'attribution'}
                  runLabel="Run Attribution"
                  completedLabel="Attributed"
                  onRun={() => handleRunAttribution()}
                  onRerun={() => handleRunAttribution({ force: true })}
                />
              }
            />
            <PipelineStage
              label="Synthesis"
              status={
                diagnostics?.latestSynthesisJob?.status ?? 'not implemented'
              }
              detail={null}
              diagnostics={diagnostics?.latestSynthesisJob}
              timerJob={getStageTimerJob({
                job: diagnostics?.latestSynthesisJob,
                isLocallyRunning: false,
                runningStartedAt,
              })}
            />
          </ol>
          {error ? (
            <p className="mt-3 font-serif text-orange-950" role="alert">
              {error}
            </p>
          ) : null}
          <PipelineRerunDialog
            stage={confirmRerunStage}
            isRunning={runningStage !== null}
            onOpenChange={(open) => {
              if (!open) {
                setConfirmRerunStage(null)
              }
            }}
            onConfirm={handleConfirmRerun}
          />
        </div>
      </section>
    </div>
  )
}

function PipelineActionButton({
  completed,
  disabled,
  isRunning,
  runLabel,
  completedLabel,
  onRun,
  onRerun,
}: {
  completed: boolean
  disabled: boolean
  isRunning: boolean
  runLabel: string
  completedLabel: string
  onRun: () => void
  onRerun: () => void
}) {
  if (completed) {
    return (
      <Button
        className="w-52 text-xl"
        onClick={onRerun}
        disabled={disabled || isRunning}
      >
        <Play className="size-4" /> {completedLabel}
      </Button>
    )
  }

  return (
    <Button
      type="button"
      size="lg"
      disabled={disabled}
      onClick={onRun}
      className="w-52 border-dashed text-xl"
    >
      <Play className="size-5" />
      {runLabel}
    </Button>
  )
}

function isActiveJobStatus(status: string) {
  return status === 'pending' || status === 'running'
}

function getActivePipelineJob(
  diagnostics: ReturnType<typeof useDocumentDiagnostics>['diagnostics'],
) {
  const jobs = [
    diagnostics?.latestIngestionJob,
    diagnostics?.latestSegmentationJob,
    diagnostics?.latestCastDetectionJob,
    diagnostics?.latestAttributionJob,
    diagnostics?.latestSynthesisJob,
  ]

  return jobs.find((job) => job && isActiveJobStatus(job.status)) ?? null
}

function getStageStatus({
  job,
  fallbackStatus,
  isLocallyRunning,
}: {
  job?: { status: string } | null
  fallbackStatus: string
  isLocallyRunning: boolean
}) {
  if (job && isActiveJobStatus(job.status)) {
    return job.status
  }
  if (isLocallyRunning) {
    return 'running'
  }
  return job?.status ?? fallbackStatus
}

function getStageTimerJob({
  job,
  isLocallyRunning,
  runningStartedAt,
}: {
  job?: { status: string; createdAt: string } | null
  isLocallyRunning: boolean
  runningStartedAt: string | null
}) {
  if (job && isActiveJobStatus(job.status)) {
    return job
  }
  if (isLocallyRunning && runningStartedAt) {
    return {
      status: 'running',
      createdAt: runningStartedAt,
    }
  }
  return null
}
