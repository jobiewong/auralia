import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import { useVoiceAssignment } from '~/hooks/use-voice-assignment'
import { formatCount, getSpeakerCounts, parseRoster } from '~/lib/utils'
import { addCastCharacter } from '~/server/documents'
import type { CastFormState } from './-components/cast-form-dialog'
import { CastFormDialog, emptyCastForm } from './-components/cast-form-dialog'
import { CastRow } from './-components/cast-row'
import { CastVoiceEditor } from './-components/cast-voice-editor'

export const Route = createFileRoute('/library/$bookSlug/$documentId/cast')({
  component: RouteComponent,
})

const NARRATOR_SPEAKER = 'NARRATOR'

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const queryClient = useQueryClient()
  const addCastCharacterFn = useServerFn(addCastCharacter)
  const spans = useDocumentSpans(bookSlug, documentId)
  const { diagnostics } = useDocumentDiagnostics(bookSlug, documentId)
  const roster = parseRoster(diagnostics?.document.roster)
  const speakerCounts = getSpeakerCounts(spans)
  const legacySpeakers = getLegacySpeakers(roster, speakerCounts)

  async function refreshCastData() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['document-diagnostics', bookSlug, documentId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['document-spans', bookSlug, documentId],
      }),
      queryClient.invalidateQueries({ queryKey: ['book-documents', bookSlug] }),
      queryClient.invalidateQueries({ queryKey: ['books'] }),
      queryClient.invalidateQueries({
        queryKey: ['document-voice-mappings', documentId],
      }),
    ])
  }

  async function addCharacter(form: CastFormState) {
    const payload = getCastPayload(documentId, form)

    await addCastCharacterFn({ data: payload })

    await refreshCastData()
  }

  const castStats = diagnostics?.latestCastDetectionJob?.stats
    ? parseStats(diagnostics.latestCastDetectionJob.stats)
    : null

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-serif text-3xl">Cast</h2>
        <div>
          <CastFormDialog
            mode="Add"
            initialForm={emptyCastForm}
            onSave={addCharacter}
          />
        </div>
      </div>

      {diagnostics?.latestCastDetectionJob && (
        <section className="mb-8 grid gap-2 border-y py-4 font-serif sm:grid-cols-4">
          <p>
            Status:
            <span className="text-foreground/50 ml-4">
              {diagnostics.latestCastDetectionJob.status}
            </span>
          </p>
          <p>
            Cast:
            <span className="text-foreground/50 ml-4">
              {formatCount(diagnostics.castCounts.total)}
            </span>
          </p>
          <p>
            Evidence:
            <span className="text-foreground/50 ml-4">
              {formatCount(getStatNumber(castStats, 'explicit_evidence_count'))}
            </span>
          </p>
          <p>
            Review:
            <span className="text-foreground/50 ml-4">
              {formatCount(diagnostics.castCounts.needsReview)}
            </span>
          </p>
        </section>
      )}
      <NarratorVoiceRow documentId={documentId} bookSlug={bookSlug} />
      {legacySpeakers.length > 0 && (
        <section className="mb-8 border-y py-5 font-serif">
          <p className="mb-4 text-foreground/50">Legacy speakers</p>
          <ul className="space-y-2">
            {legacySpeakers.map((speaker) => (
              <li
                key={speaker}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p>{speaker}</p>
                  <p className="text-foreground/50">
                    {formatCount(speakerCounts.get(speaker) ?? 0)}
                  </p>
                </div>
                <div className="flex flex-wrap items-baseline gap-3 text-foreground/50">
                  <p>not in cast</p>
                  <CastFormDialog
                    mode="Add"
                    initialForm={{
                      canonicalName: speaker,
                      aliases: '',
                      descriptor: '',
                    }}
                    onSave={addCharacter}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {roster.length === 0 ? (
        <p className="font-serif text-foreground/50">No roster cached.</p>
      ) : (
        <ul className="space-y-4 font-serif">
          {roster.map((character) => (
            <CastRow
              key={character.canonicalName}
              character={character}
              speakerCounts={speakerCounts}
              documentId={documentId}
              bookSlug={bookSlug}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function NarratorVoiceRow({
  documentId,
  bookSlug,
}: {
  documentId: string
  bookSlug: string
}) {
  const { assignVoice, voiceMapping, voiceOptions } = useVoiceAssignment({
    bookSlug,
    documentId,
    speaker: NARRATOR_SPEAKER,
  })

  return (
    <section className="mb-8 border-b py-5 font-serif">
      <div className="flex items-center justify-between">
        <p>Narrator</p>
        <div className="flex justify-end  text-foreground/50">
          <CastVoiceEditor
            voiceId={voiceMapping?.voiceId ?? ''}
            voiceOptions={voiceOptions}
            onSave={assignVoice}
          />
        </div>
      </div>
    </section>
  )
}

export function getCastPayload(documentId: string, form: CastFormState) {
  return {
    documentId,
    canonicalName: form.canonicalName,
    aliases: parseAliases(form.aliases),
    descriptor: form.descriptor.trim() || null,
  }
}

function getLegacySpeakers(
  roster: ReturnType<typeof parseRoster>,
  speakerCounts: Map<string, number>,
) {
  const rosterNames = new Set(
    roster.map((character) => character.canonicalName.toLowerCase()),
  )
  return Array.from(speakerCounts.keys())
    .filter((speaker) => speaker !== 'UNKNOWN')
    .filter((speaker) => !rosterNames.has(speaker.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
}

export function parseAliases(value: string) {
  return value
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean)
}

function parseStats(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function getStatNumber(stats: Record<string, unknown> | null, key: string) {
  const value = stats?.[key]
  return typeof value === 'number' ? value : 0
}
