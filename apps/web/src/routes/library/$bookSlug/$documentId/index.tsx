import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
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
  const spans = useDocumentSpans(bookSlug, documentId)
  const diagnostics = useDocumentDiagnostics(bookSlug, documentId)
  const reviewCount = countReviewSpans(spans)

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
        </div>
        <JobSummary
          title="Segmentation Job"
          job={diagnostics?.latestSegmentationJob ?? null}
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
    updatedAt: string
  } | null
}) {
  return (
    <section className="font-serif">
      <h2 className="mb-5 text-3xl">{title}</h2>
      {!job ? (
        <p className="text-foreground/50">No job recorded.</p>
      ) : (
        <dl className="grid gap-2 border-t py-5 sm:grid-cols-[9rem_1fr]">
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
