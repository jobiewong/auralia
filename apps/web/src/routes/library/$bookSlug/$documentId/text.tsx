import { createFileRoute } from '@tanstack/react-router'

import type { DocumentSpan } from '~/db-collections'
import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import {
  countAttributed,
  countByType,
  countUnknown,
  formatConfidence,
  formatCount,
  formatMetric,
  formatSpanCount,
  formatTextLength,
} from '~/lib/utils'

export const Route = createFileRoute('/library/$bookSlug/$documentId/text')({
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const spans = useDocumentSpans(bookSlug, documentId)
  const diagnostics = useDocumentDiagnostics(bookSlug, documentId)

  return (
    <div className="grid gap-10">
      <section>
        <h2 className="mb-5 font-serif text-3xl">Text</h2>
        <div className="border-y grid gap-10 font-serif lg:grid-cols-2">
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
      </section>

      <section>
        {spans.length === 0 ? (
          <p className="font-serif text-foreground/50">No spans yet.</p>
        ) : (
          <ol className="space-y-3">
            {spans.map((span, index) => (
              <Span key={span.id} span={span} index={index} />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function Span({ span, index }: { span: DocumentSpan; index: number }) {
  return (
    <li
      key={span.id}
      className="grid gap-2 font-serif sm:grid-cols-[4rem_9rem_minmax(0,1fr)_auto] sm:items-baseline"
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
      </div>
    </li>
  )
}
