import { createFileRoute } from '@tanstack/react-router'

import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import { countNeedsReview, formatMetric, formatSpanCount } from '~/lib/utils'

export const Route = createFileRoute(
  '/library/$bookSlug/$documentId/synthesis',
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const spans = useDocumentSpans(bookSlug, documentId)
  const { diagnostics } = useDocumentDiagnostics(bookSlug, documentId)
  const needsReview =
    diagnostics?.attributionCounts.needsReview ?? countNeedsReview(spans)

  return (
    <section className="font-serif">
      <h2 className="mb-5 text-3xl">Synthesis</h2>
      <dl className="grid max-w-4xl gap-2 border-y py-5 sm:grid-cols-[12rem_1fr]">
        <dt className="text-foreground/50">Status</dt>
        <dd>{needsReview > 0 ? 'blocked' : 'not started'}</dd>
        <dt className="text-foreground/50">Reason</dt>
        <dd>
          {needsReview > 0
            ? `${formatMetric(needsReview, 'needs review')} before synthesis`
            : 'voice mapping and synthesis job controls will land here'}
        </dd>
        <dt className="text-foreground/50">Input</dt>
        <dd>{formatSpanCount(spans.length)}</dd>
      </dl>
    </section>
  )
}
