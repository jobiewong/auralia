import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { FormEvent } from 'react'
import { useState } from 'react'

import { BracketButton } from '~/components/bracket-button'
import { DeleteConfirmationDialog } from '~/components/delete-confirmation-dialog'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { useDocumentDiagnostics, useDocumentSpans } from '~/db-collections'
import {
  addCastCharacter,
  deleteCastCharacter,
  updateCastCharacter,
} from '~/db/documents'
import {
  clearVoiceMapping,
  listDocumentVoiceMappings,
  listVoices,
  upsertVoiceMapping,
} from '~/db/voices'
import { formatCount, getSpeakerCounts, parseRoster } from '~/lib/utils'

export const Route = createFileRoute('/library/$bookSlug/$documentId/cast')({
  component: RouteComponent,
})

type CastFormState = {
  canonicalName: string
  aliases: string
  descriptor: string
}

const emptyCastForm: CastFormState = {
  canonicalName: '',
  aliases: '',
  descriptor: '',
}

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const queryClient = useQueryClient()
  const addCastCharacterFn = useServerFn(addCastCharacter)
  const updateCastCharacterFn = useServerFn(updateCastCharacter)
  const deleteCastCharacterFn = useServerFn(deleteCastCharacter)
  const upsertVoiceMappingFn = useServerFn(upsertVoiceMapping)
  const clearVoiceMappingFn = useServerFn(clearVoiceMapping)
  const spans = useDocumentSpans(bookSlug, documentId)
  const diagnostics = useDocumentDiagnostics(bookSlug, documentId)
  const roster = parseRoster(diagnostics?.document.roster)
  const speakerCounts = getSpeakerCounts(spans)
  const legacySpeakers = getLegacySpeakers(roster, speakerCounts)
  const { data: voices = [] } = useQuery({
    queryKey: ['voices'],
    queryFn: () => listVoices(),
  })
  const { data: voiceMappings = [] } = useQuery({
    queryKey: ['document-voice-mappings', documentId],
    queryFn: () => listDocumentVoiceMappings({ data: { documentId } }),
  })
  const mappingBySpeaker = new Map(
    voiceMappings.map((mapping) => [mapping.speaker, mapping.voiceId]),
  )

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

  async function assignVoice(speaker: string, voiceId: string) {
    if (!voiceId) {
      await clearVoiceMappingFn({ data: { documentId, speaker } })
    } else {
      await upsertVoiceMappingFn({ data: { documentId, speaker, voiceId } })
    }
    await refreshCastData()
  }

  async function saveCastCharacter({
    form,
    originalName,
  }: {
    form: CastFormState
    originalName: string | null
  }) {
    const payload = getCastPayload(documentId, form)

    if (originalName) {
      await updateCastCharacterFn({
        data: {
          ...payload,
          originalName,
        },
      })
    } else {
      await addCastCharacterFn({ data: payload })
    }

    await refreshCastData()
  }

  async function removeCharacter(canonicalName: string) {
    await deleteCastCharacterFn({
      data: {
        documentId,
        canonicalName,
      },
    })
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
          {/* <Button
          type="button"
          disabled={isDetectingCast}
          onClick={detectCast}
          className="border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-orange-950 disabled:opacity-50"
        >
          {isDetectingCast ? 'Detecting' : 'Detect Cast'}
        </Button> */}
          <CastFormDialog
            mode="Add"
            initialForm={emptyCastForm}
            onSave={(form) => saveCastCharacter({ form, originalName: null })}
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

      <section className="mb-8 border-y py-5 font-serif">
        <p className="mb-4 text-foreground/50">Voice assignments</p>
        <ul className="space-y-3">
          <VoiceAssignmentRow
            label="Narrator"
            voices={voices}
            value={mappingBySpeaker.get('NARRATOR') ?? ''}
            onChange={(voiceId) => assignVoice('NARRATOR', voiceId)}
          />
          {roster
            .filter((character) => character.canonicalName !== 'UNKNOWN')
            .map((character) => (
              <VoiceAssignmentRow
                key={character.canonicalName}
                label={character.canonicalName}
                voices={voices}
                value={mappingBySpeaker.get(character.canonicalName) ?? ''}
                onChange={(voiceId) =>
                  assignVoice(character.canonicalName, voiceId)
                }
              />
            ))}
        </ul>
      </section>

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
                    onSave={(form) =>
                      saveCastCharacter({ form, originalName: null })
                    }
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
            <li
              key={character.canonicalName}
              className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_14rem]"
            >
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p>{character.canonicalName}</p>
                  <p className="text-foreground/50">
                    {formatCount(
                      speakerCounts.get(character.canonicalName) ?? 0,
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
              <div className="flex flex-col items-end gap-3 text-foreground/50">
                <p>voice unmapped</p>
                <div className="flex gap-2">
                  <CastFormDialog
                    mode="Edit"
                    initialForm={{
                      canonicalName: character.canonicalName,
                      aliases: character.aliases.join(', '),
                      descriptor: character.descriptor ?? '',
                    }}
                    onSave={(form) =>
                      saveCastCharacter({
                        form,
                        originalName: character.canonicalName,
                      })
                    }
                  />
                  <DeleteConfirmationDialog
                    className="h-auto p-0! opacity-50 hover:opacity-100 font-serif text-orange-950 hover:no-underline hover:bg-orange-950/10 hover:text-orange-950"
                    title="Delete cast member"
                    description={`Remove ${character.canonicalName} from this document's cast list? Existing span attributions will remain assigned to this speaker.`}
                    triggerLabel="[Delete]"
                    confirmLabel="Delete"
                    onConfirm={() => removeCharacter(character.canonicalName)}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function VoiceAssignmentRow({
  label,
  voices,
  value,
  onChange,
}: {
  label: string
  voices: Array<{ id: string; displayName: string; mode: string }>
  value: string
  onChange: (voiceId: string) => Promise<void>
}) {
  const [isSaving, setIsSaving] = useState(false)

  async function handleChange(voiceId: string) {
    setIsSaving(true)
    try {
      await onChange(voiceId)
    } finally {
      setIsSaving(false)
    }
  }

  const selectedVoice = voices.find((voice) => voice.id === value)

  return (
    <li className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <p>{label}</p>
        <p className="text-foreground/50">
          {selectedVoice ? selectedVoice.displayName : 'voice unmapped'}
        </p>
      </div>
      <select
        value={value}
        disabled={isSaving}
        onChange={(event) => handleChange(event.target.value)}
        className="border-b bg-transparent px-1 py-1"
      >
        <option value="">Unmapped</option>
        {voices.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.displayName}
          </option>
        ))}
      </select>
    </li>
  )
}

function CastFormDialog({
  mode,
  initialForm,
  onSave,
}: {
  mode: 'Add' | 'Edit'
  initialForm: CastFormState
  onSave: (form: CastFormState) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [isSaving, setIsSaving] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setForm(initialForm)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    try {
      await onSave(form)
      setOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <BracketButton>{mode}</BracketButton>
      </DialogTrigger>
      <DialogContent className="w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode} Cast</DialogTitle>
        </DialogHeader>
        <form className="mt-8 grid gap-5 font-serif" onSubmit={handleSubmit}>
          <label className="grid gap-2">
            <span className="text-orange-500/60">Name</span>
            <Input
              value={form.canonicalName}
              onChange={(event) =>
                setForm({ ...form, canonicalName: event.target.value })
              }
              variant="underline"
              className="text-orange-500"
              required
            />
          </label>

          <label className="grid gap-2">
            <span className="text-orange-500/60">Aliases</span>
            <Input
              value={form.aliases}
              onChange={(event) =>
                setForm({ ...form, aliases: event.target.value })
              }
              variant="underline"
              className="text-orange-500 placeholder:text-orange-500/40"
              placeholder="comma separated"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-orange-500/60">Descriptor</span>
            <Input
              value={form.descriptor}
              onChange={(event) =>
                setForm({ ...form, descriptor: event.target.value })
              }
              variant="underline"
              className="text-orange-500"
            />
          </label>

          <DialogFooter>
            <Button
              type="submit"
              variant="confirm"
              disabled={isSaving}
              size="lg"
            >
              {isSaving ? 'Saving' : mode === 'Edit' ? 'Save' : 'Add'}
            </Button>
            <DialogClose asChild>
              <Button variant="cancel" disabled={isSaving} size="lg">
                Cancel
              </Button>
            </DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function getCastPayload(documentId: string, form: CastFormState) {
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

function parseAliases(value: string) {
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
