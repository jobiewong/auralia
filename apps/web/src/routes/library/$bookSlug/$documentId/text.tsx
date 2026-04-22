import { createFileRoute } from '@tanstack/react-router'

import { useDocumentSpans } from '~/db-collections'
import { formatConfidence, formatTextLength } from '~/lib/utils'

export const Route = createFileRoute('/library/$bookSlug/$documentId/text')({
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const spans = useDocumentSpans(bookSlug, documentId)

  if (spans.length === 0) {
    return <p className="font-serif text-foreground/50">No spans yet.</p>
  }

  return (
    <section>
      <h2 className="mb-5 font-serif text-3xl">Text</h2>
      <ol className="space-y-3">
        {spans.map((span, index) => (
          <li
            key={span.id}
            className="grid gap-2 font-serif sm:grid-cols-[4rem_9rem_minmax(0,1fr)_auto] sm:items-baseline"
          >
            <p className="text-foreground/50">
              {String(index + 1).padStart(2, '0')}
            </p>
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
                {span.start}-{span.end} /{' '}
                {formatTextLength(span.end - span.start)}
              </p>
            </div>
            <p className="text-foreground/50">
              {span.needsReview
                ? 'review'
                : span.speaker
                  ? 'attributed'
                  : span.type === 'dialogue'
                    ? 'unattributed'
                    : ''}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
