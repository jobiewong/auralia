import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import type { Voice } from '~/db-collections'
import { getVoicesCollection, preloadVoices, useVoices } from '~/db-collections'
import { createVoicePreview } from '~/lib/voices-api'
import type { z } from 'zod/v4'
import { VoiceItem } from './-components/voice-item'
import { VoiceDialog, voiceFormSchema, type PreviewStatus } from './-components/voice-dialog'

export const Route = createFileRoute('/voices/')({
  ssr: false,
  beforeLoad: ({ context }) => preloadVoices(context.queryClient),
  component: VoicesRoute,
})

function cleanOptional(value?: string | null) {
  return value?.trim() || null
}

function hasNewUpload(value?: File) {
  return Boolean(value && value.size > 0)
}

function previewInputsChanged(
  voice: Voice,
  values: z.infer<typeof voiceFormSchema>,
) {
  return (
    values.mode !== voice.mode ||
    cleanOptional(values.controlText) !== voice.controlText ||
    cleanOptional(values.promptText) !== voice.promptText ||
    values.temperature !== voice.temperature ||
    hasNewUpload(values.referenceAudio) ||
    hasNewUpload(values.promptAudio)
  )
}

function VoicesRoute() {
  const queryClient = useQueryClient()
  const voicesCollection = getVoicesCollection(queryClient)
  const [error, setError] = useState<string | null>(null)
  const [previewStatuses, setPreviewStatuses] = useState<
    Record<string, PreviewStatus>
  >({})
  const previewGenerationQueue = useRef<Record<string, Promise<void>>>({})
  const voices = useVoices()

  function generatePreviewInBackground(voiceId: string) {
    setPreviewStatuses((current) => ({
      ...current,
      [voiceId]: 'generating',
    }))

    const previous =
      previewGenerationQueue.current[voiceId] ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        setPreviewStatuses((current) => ({
          ...current,
          [voiceId]: 'generating',
        }))
        await createVoicePreview(voiceId)
        await queryClient.invalidateQueries({ queryKey: ['voices'] })
        setPreviewStatuses((current) => ({
          ...current,
          [voiceId]: 'ready',
        }))
      })
      .catch((err) => {
        setPreviewStatuses((current) => ({
          ...current,
          [voiceId]: 'failed',
        }))
        setError(err instanceof Error ? err.message : 'Preview failed')
      })

    previewGenerationQueue.current[voiceId] = next
    void next.finally(() => {
      if (previewGenerationQueue.current[voiceId] === next) {
        delete previewGenerationQueue.current[voiceId]
      }
    })
  }

  async function submitVoice(
    values: z.infer<typeof voiceFormSchema>,
    voice?: Voice,
  ) {
    setError(null)
    try {
      let voiceId: string
      let shouldGeneratePreview = true
      if (voice) {
        voiceId = voice.id
        shouldGeneratePreview = previewInputsChanged(voice, values)
        const tx = voicesCollection.update(
          voice.id,
          { metadata: values },
          (draft) => {
            draft.displayName = values.displayName
            draft.mode = values.mode
            draft.controlText = values.controlText?.trim() || null
            draft.promptText = values.promptText?.trim() || null
            draft.temperature = values.temperature
            if (shouldGeneratePreview) {
              draft.previewAudioPath = null
              draft.previewSentence = null
            }
            draft.updatedAt = new Date().toISOString()
          },
        )
        await tx.isPersisted.promise
      } else {
        const now = new Date().toISOString()
        voiceId = `voice_${crypto.randomUUID().replaceAll('-', '')}`
        const tx = voicesCollection.insert(
          {
            id: voiceId,
            displayName: values.displayName,
            mode: values.mode,
            controlText: values.controlText?.trim() || null,
            referenceAudioPath: null,
            promptAudioPath: null,
            promptText: values.promptText?.trim() || null,
            temperature: values.temperature,
            isCanonical: true,
            previewAudioPath: null,
            previewSentence: null,
            createdAt: now,
            updatedAt: now,
          },
          { metadata: values },
        )
        await tx.isPersisted.promise
      }
      await queryClient.invalidateQueries({ queryKey: ['voices'] })
      if (shouldGeneratePreview) {
        generatePreviewInBackground(voiceId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice save failed')
      throw err
    }
  }

  async function handleDelete(voiceId: string, force: boolean) {
    setError(null)
    try {
      const tx = voicesCollection.delete(voiceId, { metadata: { force } })
      await tx.isPersisted.promise
      await queryClient.invalidateQueries({ queryKey: ['voices'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <main className="page-wrap">
      <section className="px-6 py-10 sm:px-10 sm:py-14">
        <p className="mb-4 font-serif text-xl text-foreground/50">
          <Link to="/" className="hover:underline">
            Auralia
          </Link>{' '}
          / Voices
        </p>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="display-title">Voices</h1>
          <VoiceDialog
            label="New Voice"
            onSubmit={(values) => submitVoice(values)}
          />
        </div>

        {error && <p className="mb-5 font-serif text-orange-500">{error}</p>}

        {voices.length === 0 ? (
          <p className="font-serif text-foreground/60">No voices yet.</p>
        ) : (
          <ul className="space-y-3 font-serif -mx-2">
            {voices.map((voice) => (
              <VoiceItem
                key={voice.id}
                voice={voice}
                previewStatus={previewStatuses[voice.id]}
                onEdit={(values) => submitVoice(values, voice)}
                onDelete={() => handleDelete(voice.id, false)}
                onForceDelete={() => handleDelete(voice.id, true)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
