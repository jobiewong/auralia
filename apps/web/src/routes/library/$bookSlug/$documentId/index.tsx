import { createFileRoute } from '@tanstack/react-router'

import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import {
  countAttributed,
  countByType,
  countNeedsReview,
  countUnknown,
  formatConfidence,
  formatCount,
  formatDate,
  formatJsonSummary,
  formatMetric,
  formatSpanCount,
} from '~/lib/utils'

export const Route = createFileRoute('/library/$bookSlug/$documentId/')({
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const spans = useDocumentSpans(bookSlug, documentId)
  const diagnostics = useDocumentDiagnostics(bookSlug, documentId)

  return (
    <div className="grid gap-12">
      <section>
        <h2 className="mb-5 font-serif text-3xl">Pipeline</h2>
        <ol className="space-y-2 font-serif">
          <PipelineStage
            label="Ingested"
            status="complete"
            detail="document stored"
          />
          <PipelineStage
            label="Segmented"
            status={diagnostics?.latestSegmentationJob?.status ?? 'missing'}
            detail={`${formatSpanCount(
              diagnostics?.spanCounts.total ?? spans.length,
            )} / ${formatCount(
              diagnostics?.spanCounts.dialogue ?? countByType(spans, 'dialogue'),
              'dialogue',
            )} / ${formatCount(
              diagnostics?.spanCounts.narration ??
                countByType(spans, 'narration'),
              'narration',
            )}`}
          />
          <PipelineStage
            label="Attributed"
            status={diagnostics?.latestAttributionJob?.status ?? 'missing'}
            detail={`${formatMetric(
              diagnostics?.attributionCounts.attributed ?? countAttributed(spans),
              'attributed',
            )} / ${formatConfidence(
              diagnostics?.attributionCounts.averageConfidence,
            )}`}
          />
          <PipelineStage
            label="Review"
            status={
              (diagnostics?.attributionCounts.needsReview ??
                countNeedsReview(spans)) > 0
                ? 'needs review'
                : 'clear'
            }
            detail={`${formatMetric(
              diagnostics?.attributionCounts.needsReview ??
                countNeedsReview(spans),
              'needs review',
            )} / ${formatMetric(
              diagnostics?.attributionCounts.unknown ?? countUnknown(spans),
              'unknown',
            )}`}
          />
        </ol>
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        <JobSummary
          title="Segmentation Job"
          job={diagnostics?.latestSegmentationJob ?? null}
        />
        <JobSummary
          title="Attribution Job"
          job={diagnostics?.latestAttributionJob ?? null}
        />
      </div>
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
  detail: string
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
    updatedAt: string
  } | null
}) {
  return (
    <section className="font-serif">
      <h2 className="mb-5 text-3xl">{title}</h2>
      {!job ? (
        <p className="text-foreground/50">No job recorded.</p>
      ) : (
        <dl className="grid gap-2 border-y py-5 sm:grid-cols-[9rem_1fr]">
          <dt className="text-foreground/50">Status</dt>
          <dd>{job.status}</dd>
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
