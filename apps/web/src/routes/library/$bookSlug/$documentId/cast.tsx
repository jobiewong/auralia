import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

import { BracketButton } from '~/components/bracket-button'
import { DeleteConfirmationDialog } from '~/components/delete-confirmation-dialog'
import { Button } from '~/components/ui/button'
import type { ComboboxOption } from '~/components/ui/combobox-custom'
import { Combobox } from '~/components/ui/combobox-custom'
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
import {
  getDocumentVoiceMappingsCollection,
  useDocumentDiagnostics,
  useDocumentSpans,
  useDocumentVoiceMappings,
  useVoices,
} from '~/db-collections'
import {
  addCastCharacter,
  deleteCastCharacter,
  updateCastCharacter,
} from '~/db/documents'
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
      <NarratorVoiceRow documentId={documentId} />
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
            />
          ))}
        </ul>
      )}
    </section>
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

interface CastCharacter {
  canonicalName: string
  aliases: string[]
  descriptor: string | null
}

function CastRow({
  character,
  speakerCounts,
  documentId,
}: {
  character: CastCharacter
  speakerCounts: Map<string, number>
  documentId: string
}) {
  const { bookSlug } = Route.useParams()
  const updateCastCharacterFn = useServerFn(updateCastCharacter)
  const deleteCastCharacterFn = useServerFn(deleteCastCharacter)
  const { assignVoice, refreshCastData, voiceMapping, voiceOptions } =
    useVoiceAssignment({
      bookSlug,
      documentId,
      speaker: character.canonicalName,
    })

  async function saveCastCharacter(form: CastFormState) {
    await updateCastCharacterFn({
      data: {
        ...getCastPayload(documentId, form),
        originalName: character.canonicalName,
      },
    })
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
  return (
    <li className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p>{character.canonicalName}</p>
          <p className="text-foreground/50">
            {formatCount(speakerCounts.get(character.canonicalName) ?? 0)}
          </p>
        </div>
        {character.aliases.length > 0 && (
          <p className="text-foreground/50">{character.aliases.join(' / ')}</p>
        )}
        {character.descriptor && (
          <p className="text-foreground/50">{character.descriptor}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-3 text-foreground/50">
        <CastVoiceEditor
          voiceId={voiceMapping?.voiceId ?? ''}
          voiceOptions={voiceOptions}
          onSave={assignVoice}
        />
        <div className="flex gap-2">
          <CastFormDialog
            mode="Edit"
            initialForm={{
              canonicalName: character.canonicalName,
              aliases: character.aliases.join(', '),
              descriptor: character.descriptor ?? '',
            }}
            onSave={saveCastCharacter}
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
  )
}

function NarratorVoiceRow({ documentId }: { documentId: string }) {
  const { bookSlug } = Route.useParams()
  const { assignVoice, selectedVoice, voiceMapping, voiceOptions } =
    useVoiceAssignment({
      bookSlug,
      documentId,
      speaker: NARRATOR_SPEAKER,
    })

  return (
    <section className="mb-8 border-b py-5 font-serif">
      <div className="flex items-center justify-between">
        <p>Narrator</p>
        <div className="flex justify-end text-foreground/50">
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

function useVoiceAssignment({
  bookSlug,
  documentId,
  speaker,
}: {
  bookSlug: string
  documentId: string
  speaker: string
}) {
  const queryClient = useQueryClient()
  const voiceMappingsCollection = getDocumentVoiceMappingsCollection(
    queryClient,
    documentId,
  )
  const voices = useVoices()
  const voiceMappings = useDocumentVoiceMappings(documentId)
  const voiceMapping = voiceMappings.find(
    (mapping) => mapping.speaker === speaker,
  )
  const voiceOptions = getVoiceOptions(voices)
  const selectedVoice = voices.find(
    (voice) => voice.id === voiceMapping?.voiceId,
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

  async function assignVoice(voiceId: string) {
    let tx: { isPersisted: { promise: Promise<unknown> } }
    if (!voiceId) {
      if (!voiceMapping) {
        return
      }
      tx = voiceMappingsCollection.delete(speaker)
    } else if (voiceMapping) {
      tx = voiceMappingsCollection.update(speaker, (draft) => {
        draft.voiceId = voiceId
        draft.updatedAt = new Date().toISOString()
      })
    } else {
      const now = new Date().toISOString()
      tx = voiceMappingsCollection.insert({
        id: `voice_mapping_${crypto.randomUUID().replaceAll('-', '')}`,
        documentId,
        speaker,
        voiceId,
        voiceName:
          voices.find((voice) => voice.id === voiceId)?.displayName ?? null,
        createdAt: now,
        updatedAt: now,
      })
    }
    await tx.isPersisted.promise
    await refreshCastData()
  }

  return {
    assignVoice,
    refreshCastData,
    selectedVoice,
    voiceMapping,
    voiceOptions,
  }
}

function CastVoiceEditor({
  voiceId,
  voiceOptions,
  onSave,
}: {
  voiceId: string
  voiceOptions: ComboboxOption[]
  onSave: (voiceId: string) => Promise<void>
}) {
  const [selectedVoiceId, setSelectedVoiceId] = useState(voiceId)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setSelectedVoiceId(voiceId)
  }, [voiceId])

  async function save() {
    setIsSaving(true)
    try {
      await onSave(selectedVoiceId)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-x-3 gap-y-2 text-foreground">
      <span>voice:</span>
      <Combobox
        value={selectedVoiceId}
        options={voiceOptions}
        searchPlaceholder="Search voices"
        onValueChange={setSelectedVoiceId}
      />
      <BracketButton disabled={isSaving} onClick={save}>
        Save
      </BracketButton>
    </div>
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

function getVoiceOptions(voices: Array<{ id: string; displayName: string }>) {
  return [
    { value: '', label: 'Unmapped' },
    ...voices.map((voice) => ({
      value: voice.id,
      label: voice.displayName,
    })),
  ]
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
