import { useHotkey } from '@tanstack/react-hotkeys'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { BracketButton } from '~/components/bracket-button'

import { Play } from '~/components/icons/play'
import type { ComboboxOption } from '~/components/ui/combobox-custom'
import { Combobox } from '~/components/ui/combobox-custom'
import { ConfirmationButton } from '~/components/ui/confirmation-button'
import type { DocumentSpan } from '~/db-collections'
import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import { updateSpanAttribution } from '~/db/documents'
import { formatElapsed, useElapsedSeconds } from '~/hooks/use-elapsed-seconds'
import {
  runAttribution,
  runCastDetection,
  runSegmentation,
} from '~/lib/pipeline-api'
import {
  cn,
  countAttributed,
  countByType,
  countReviewSpans,
  countUnknown,
  formatConfidence,
  formatCount,
  formatMetric,
  formatSpanCount,
  formatTextLength,
  parseRoster,
} from '~/lib/utils'

export const Route = createFileRoute('/library/$bookSlug/$documentId/text')({
  component: RouteComponent,
})

type SpanFilter = 'all' | 'review' | 'unknown' | 'dialogue'

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const queryClient = useQueryClient()
  const updateAttribution = useServerFn(updateSpanAttribution)
  const spans = useDocumentSpans(bookSlug, documentId)
  const diagnostics = useDocumentDiagnostics(bookSlug, documentId)
  const [activeSpanId, setActiveSpanId] = useState<string | null>(null)
  const [filter, setFilter] = useState<SpanFilter>('all')
  const [runningStage, setRunningStage] = useState<
    'segmentation' | 'cast detection' | 'attribution' | null
  >(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const elapsed = useElapsedSeconds(startedAt)
  const speakerOptions = useMemo(
    () => getSpeakerOptions(diagnostics?.document.roster, spans),
    [diagnostics?.document.roster, spans],
  )
  const visibleSpans = useMemo(
    () => getVisibleSpans(spans, filter),
    [filter, spans],
  )
  const reviewSpans = spans.filter(isReviewSpan)
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
    setPipelineError(null)

    try {
      await runSegmentation(documentId)
      await refreshDocumentState()
    } catch (err) {
      setPipelineError(
        err instanceof Error ? err.message : 'Segmentation failed',
      )
    } finally {
      setRunningStage(null)
      setStartedAt(null)
    }
  }

  async function handleRunAttribution() {
    if (!hasCompletedSegmentation) {
      setPipelineError('Run segmentation before attribution.')
      return
    }
    if (!hasCompletedCastDetection) {
      setPipelineError('Run cast detection before attribution.')
      return
    }

    setRunningStage('attribution')
    setStartedAt(Date.now())
    setPipelineError(null)

    try {
      await runAttribution(documentId)
      await refreshDocumentState()
    } catch (err) {
      setPipelineError(
        err instanceof Error ? err.message : 'Attribution failed',
      )
    } finally {
      setRunningStage(null)
      setStartedAt(null)
    }
  }

  async function handleRunCastDetection() {
    if (!hasCompletedSegmentation) {
      setPipelineError('Run segmentation before cast detection.')
      return
    }

    setRunningStage('cast detection')
    setStartedAt(Date.now())
    setPipelineError(null)

    try {
      await runCastDetection(documentId)
      await refreshDocumentState()
    } catch (err) {
      setPipelineError(
        err instanceof Error ? err.message : 'Cast detection failed',
      )
    } finally {
      setRunningStage(null)
      setStartedAt(null)
    }
  }

  async function handleSaveAttribution({
    spanId,
    speaker,
    needsReview,
  }: {
    spanId: string
    speaker: string
    needsReview: boolean
  }) {
    await updateAttribution({ data: { spanId, speaker, needsReview } })
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

  function moveToReview(direction: 1 | -1) {
    if (reviewSpans.length === 0) {
      return
    }
    const activeIndex = activeSpanId
      ? reviewSpans.findIndex((span) => span.id === activeSpanId)
      : -1
    const fallbackIndex = direction === 1 ? 0 : reviewSpans.length - 1
    const nextIndex =
      activeIndex === -1
        ? fallbackIndex
        : (activeIndex + direction + reviewSpans.length) % reviewSpans.length
    const nextSpan = reviewSpans[nextIndex]

    setActiveSpanId(nextSpan.id)
    document.getElementById(`span-${nextSpan.id}`)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  }

  function handleActivateSpan(span: DocumentSpan) {
    setActiveSpanId((currentSpanId) =>
      currentSpanId === span.id && !isReviewSpan(span) ? null : span.id,
    )
  }

  useHotkey('ArrowRight', () => moveToReview(1))
  useHotkey('ArrowLeft', () => moveToReview(-1))

  return (
    <div className="grid gap-10">
      <section>
        <h2 className="mb-5 font-serif text-3xl">Text</h2>
        <div className="grid gap-10 border-y font-serif lg:grid-cols-2">
          <dl className="grid gap-2 py-5 sm:grid-cols-[10rem_1fr]">
            <dt className="text-foreground/50">Segments</dt>
            <dd>
              {formatSpanCount(diagnostics?.spanCounts.total ?? spans.length)}
            </dd>
            <dt className="text-foreground/50">Dialogue</dt>
            <dd>
              {formatCount(
                diagnostics?.spanCounts.dialogue ??
                  countByType(spans, 'dialogue'),
                'dialogue',
              )}
            </dd>
            <dt className="text-foreground/50">Narration</dt>
            <dd>
              {formatCount(
                diagnostics?.spanCounts.narration ??
                  countByType(spans, 'narration'),
                'narration',
              )}
            </dd>
          </dl>

          <dl className="grid gap-2 py-5 sm:grid-cols-[10rem_1fr]">
            <dt className="text-foreground/50">Cast</dt>
            <dd>
              {formatMetric(diagnostics?.castCounts.total ?? 0, 'members')}
            </dd>
            {/* <dt className="text-foreground/50">Cast Review</dt>
            <dd>
              {formatMetric(
                diagnostics?.castCounts.needsReview ?? 0,
                'needs review',
              )}
            </dd> */}
            <dt className="text-foreground/50">Attribution</dt>
            <dd>
              {formatMetric(
                diagnostics?.attributionCounts.attributed ??
                  countAttributed(spans),
                'attributed',
              )}
            </dd>
            <dt className="text-foreground/50">Confidence</dt>
            <dd>
              {formatConfidence(
                diagnostics?.attributionCounts.averageConfidence,
              )}
            </dd>
            <dt className="text-foreground/50">Unattributed</dt>
            <dd>
              {formatMetric(
                diagnostics?.attributionCounts.unknown ?? countUnknown(spans),
                'unknown',
              )}
            </dd>
          </dl>
        </div>
        <div className="mt-4 flex gap-4">
          <ConfirmationButton
            className="w-52 text-xl"
            disabled={runningStage !== null || hasCompletedSegmentation}
            onLongPress={handleRunSegmentation}
          >
            <Play className="size-4" />{' '}
            {hasCompletedSegmentation ? 'Segmented' : 'Run Segmentation'}
          </ConfirmationButton>
          <ConfirmationButton
            className="w-52 text-xl"
            disabled={!canRunCastDetection || hasCompletedCastDetection}
            onLongPress={handleRunCastDetection}
          >
            <Play className="size-4" />{' '}
            {hasCompletedCastDetection ? 'Cast Detected' : 'Detect Cast'}
          </ConfirmationButton>
          <ConfirmationButton
            className="w-52 text-xl"
            disabled={!canRunAttribution || hasCompletedAttribution}
            onLongPress={handleRunAttribution}
          >
            <Play className="size-4" />{' '}
            {hasCompletedAttribution ? 'Attributed' : 'Run Attribution'}
          </ConfirmationButton>
          {runningStage ? (
            <p className="flex items-center gap-2 font-serif text-lg text-foreground/60">
              <Clock className="size-5" />
              {runningStage} running for {formatElapsed(elapsed)}
            </p>
          ) : null}
        </div>
        {!hasCompletedSegmentation ? (
          <p className="mt-3 font-serif text-foreground/60">
            Cast detection unlocks after segmentation has completed.
          </p>
        ) : null}
        {hasCompletedSegmentation && !hasCompletedCastDetection ? (
          <p className="mt-3 font-serif text-foreground/60">
            Attribution unlocks after cast detection has completed.
          </p>
        ) : null}
        {pipelineError ? (
          <p className="mt-3 font-serif text-orange-950" role="alert">
            {pipelineError}
          </p>
        ) : null}
      </section>

      <section className="flex flex-wrap items-center gap-4 font-serif sticky -mx-2 px-2 py-1 top-4 bg-background">
        <p className="text-foreground/50">Show</p>
        <FilterButton filter={filter} value="all" onChange={setFilter}>
          All
        </FilterButton>
        <FilterButton filter={filter} value="review" onChange={setFilter}>
          Needs Review
        </FilterButton>
        <FilterButton filter={filter} value="unknown" onChange={setFilter}>
          Unknown
        </FilterButton>
        <FilterButton filter={filter} value="dialogue" onChange={setFilter}>
          Dialogue
        </FilterButton>
        <div className="flex gap-2 sm:ml-auto">
          <BracketButton
            disabled={reviewSpans.length === 0}
            onClick={() => moveToReview(-1)}
          >
            Previous Review
          </BracketButton>
          <BracketButton
            disabled={reviewSpans.length === 0}
            onClick={() => moveToReview(1)}
          >
            Next Review
          </BracketButton>
        </div>
      </section>

      <section>
        {spans.length === 0 ? (
          <p className="font-serif text-foreground/50">No spans yet.</p>
        ) : (
          <ol className="-mx-2">
            {visibleSpans.map(({ span, index, context }) => (
              <Span
                key={span.id}
                span={span}
                index={index}
                context={context}
                speakerOptions={speakerOptions}
                isActive={activeSpanId === span.id}
                onActivate={() => handleActivateSpan(span)}
                onSave={handleSaveAttribution}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function FilterButton({
  filter,
  value,
  children,
  onChange,
}: {
  filter: SpanFilter
  value: SpanFilter
  children: ReactNode
  onChange: (filter: SpanFilter) => void
}) {
  return (
    <BracketButton active={filter === value} onClick={() => onChange(value)}>
      {children}
    </BracketButton>
  )
}

function Span({
  span,
  index,
  context,
  speakerOptions,
  isActive,
  onActivate,
  onSave,
}: {
  span: DocumentSpan
  index: number
  context: boolean
  speakerOptions: ComboboxOption[]
  isActive: boolean
  onActivate: () => void
  onSave: (data: {
    spanId: string
    speaker: string
    needsReview: boolean
  }) => Promise<void>
}) {
  const showEditor =
    span.type === 'dialogue' &&
    (isActive || span.needsReview || span.speaker === 'UNKNOWN')

  return (
    <li
      id={`span-${span.id}`}
      className={cn(
        'grid gap-2 py-1.5 px-2 font-serif sm:grid-cols-[4rem_9rem_minmax(0,1fr)] sm:items-baseline hover:bg-orange-950/5',
        context && 'opacity-60',
        span.needsReview && 'bg-orange-950/10 hover:bg-orange-950/10',
      )}
      onClick={onActivate}
    >
      <p className="text-foreground/50">{String(index + 1).padStart(2, '0')}</p>
      <p className="text-foreground/50">{span.type}</p>
      <div>
        {span.speaker && (
          <p className="mb-1 text-foreground/50">
            {span.speaker} / {formatConfidence(span.speakerConfidence)}
            {span.needsReview ? ' / needs review' : ''}
          </p>
        )}
        <p className="leading-tight">{span.text}</p>
        <p className="text-foreground/50">
          {span.start}-{span.end} / {formatTextLength(span.end - span.start)}
        </p>
        {showEditor && (
          <SpanAttributionEditor
            span={span}
            speakerOptions={speakerOptions}
            onSave={onSave}
          />
        )}
      </div>
    </li>
  )
}

function SpanAttributionEditor({
  span,
  speakerOptions,
  onSave,
}: {
  span: DocumentSpan
  speakerOptions: ComboboxOption[]
  onSave: (data: {
    spanId: string
    speaker: string
    needsReview: boolean
  }) => Promise<void>
}) {
  const [speaker, setSpeaker] = useState(span.speaker ?? 'UNKNOWN')
  const [isSaving, setIsSaving] = useState(false)

  async function save(nextSpeaker = speaker, needsReview = false) {
    setIsSaving(true)
    try {
      await onSave({
        spanId: span.id,
        speaker: nextSpeaker,
        needsReview,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-foreground/70"
      onClick={(event) => event.stopPropagation()}
    >
      <span>speaker:</span>
      <Combobox
        value={speaker}
        options={speakerOptions}
        searchPlaceholder="Search speakers"
        allowCustom
        onValueChange={setSpeaker}
      />
      <BracketButton disabled={isSaving} onClick={() => save()}>
        Save
      </BracketButton>
    </div>
  )
}

function getSpeakerOptions(
  roster: string | null | undefined,
  spans: DocumentSpan[],
) {
  const names = new Set<string>(['UNKNOWN'])
  for (const character of parseRoster(roster)) {
    names.add(character.canonicalName)
  }
  for (const span of spans) {
    if (span.speaker) {
      names.add(span.speaker)
    }
  }
  return Array.from(names)
    .sort((a, b) => {
      if (a === 'UNKNOWN') return -1
      if (b === 'UNKNOWN') return 1
      return a.localeCompare(b)
    })
    .map((name) => ({ value: name, label: name }))
    .sort((a, b) => {
      if (a.value === 'UNKNOWN') return -1
      if (b.value === 'UNKNOWN') return 1
      return a.label.localeCompare(b.label)
    })
}

function getVisibleSpans(spans: DocumentSpan[], filter: SpanFilter) {
  if (filter === 'all') {
    return spans.map((span, index) => ({ span, index, context: false }))
  }

  const matchingIndexes = new Set<number>()
  spans.forEach((span, index) => {
    if (spanMatchesFilter(span, filter)) {
      matchingIndexes.add(index)
      if (index > 0) matchingIndexes.add(index - 1)
      if (index < spans.length - 1) matchingIndexes.add(index + 1)
    }
  })

  return spans.flatMap((span, index) =>
    matchingIndexes.has(index)
      ? [
          {
            span,
            index,
            context: !spanMatchesFilter(span, filter),
          },
        ]
      : [],
  )
}

function spanMatchesFilter(span: DocumentSpan, filter: SpanFilter) {
  if (filter === 'review') {
    return isReviewSpan(span)
  }
  if (filter === 'unknown') {
    return span.speaker === 'UNKNOWN'
  }
  if (filter === 'dialogue') {
    return span.type === 'dialogue'
  }
  return true
}

function isReviewSpan(span: DocumentSpan) {
  return Boolean(span.needsReview || span.speaker === 'UNKNOWN')
}
