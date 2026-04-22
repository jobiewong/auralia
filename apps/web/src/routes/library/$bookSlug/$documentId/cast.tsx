import { createFileRoute } from '@tanstack/react-router'

import {
  useDocumentDiagnostics,
  useDocumentSpans,
} from '~/db-collections'
import { formatCount, getSpeakerCounts, parseRoster } from '~/lib/utils'

export const Route = createFileRoute('/library/$bookSlug/$documentId/cast')({
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const spans = useDocumentSpans(bookSlug, documentId)
  const diagnostics = useDocumentDiagnostics(bookSlug, documentId)
  const roster = parseRoster(diagnostics?.document.roster)
  const speakerCounts = getSpeakerCounts(spans)

  return (
    <section>
      <h2 className="mb-5 font-serif text-3xl">Cast</h2>
      {roster.length === 0 ? (
        <p className="font-serif text-foreground/50">No roster cached.</p>
      ) : (
        <ul className="space-y-4 font-serif">
          {roster.map((character) => (
            <li
              key={character.canonicalName}
              className="grid gap-2 border-y py-4 sm:grid-cols-[minmax(0,1fr)_14rem]"
            >
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p>{character.canonicalName}</p>
                  <p className="text-foreground/50">
                    {formatCount(
                      speakerCounts.get(character.canonicalName) ?? 0,
                      'span',
                    )}
                  </p>
                </div>
                {character.aliases.length > 0 && (
                  <p className="text-foreground/50">
                    {character.aliases.join(' / ')}
                  </p>
                )}
                {character.descriptor && (
                  <p className="text-foreground/50">{character.descriptor}</p>
                )}
              </div>
              <p className="text-foreground/50">voice unmapped</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
