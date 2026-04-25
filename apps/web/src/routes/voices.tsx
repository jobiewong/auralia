import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'

import { DeleteConfirmationDialog } from '~/components/delete-confirmation-dialog'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import type { VoiceProfile, VoiceValidationReport } from '~/db/voices'
import {
  createVoice,
  createVoicePreview,
  deleteVoice,
  listVoices,
  updateVoice,
  validateVoice,
} from '~/db/voices'

export const Route = createFileRoute('/voices')({
  ssr: false,
  component: VoicesRoute,
})

type PreviewState = {
  voiceId: string
  sentence: string
  audioUrl: string
} | null

function VoicesRoute() {
  const queryClient = useQueryClient()
  const createVoiceFn = useServerFn(createVoice)
  const updateVoiceFn = useServerFn(updateVoice)
  const deleteVoiceFn = useServerFn(deleteVoice)
  const validateVoiceFn = useServerFn(validateVoice)
  const createPreviewFn = useServerFn(createVoicePreview)
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<VoiceValidationReport | null>(
    null,
  )
  const [preview, setPreview] = useState<PreviewState>(null)
  const { data: voices = [] } = useQuery({
    queryKey: ['voices'],
    queryFn: () => listVoices(),
  })

  async function refreshVoices() {
    await queryClient.invalidateQueries({ queryKey: ['voices'] })
  }

  async function submitVoice(formData: FormData, voice?: VoiceProfile) {
    setError(null)
    try {
      if (voice) {
        formData.set('voiceId', voice.id)
        await updateVoiceFn({ data: formData })
      } else {
        await createVoiceFn({ data: formData })
      }
      await refreshVoices()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Voice save failed')
      throw error
    }
  }

  async function runValidation(voiceId: string) {
    setError(null)
    try {
      setValidation(await validateVoiceFn({ data: { voiceId } }))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Validation failed')
    }
  }

  async function runPreview(voiceId: string) {
    setError(null)
    try {
      const result = await createPreviewFn({ data: { voiceId } })
      setPreview({
        voiceId,
        sentence: result.sentence,
        audioUrl: result.audioUrl,
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Preview failed')
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
            onSubmit={(form) => submitVoice(form)}
          />
        </div>

        {error && <p className="mb-5 font-serif text-orange-500">{error}</p>}
        {validation && <ValidationReport report={validation} />}
        {preview && (
          <section className="mb-6 border-y py-4 font-serif">
            <p className="text-foreground/50">Preview sentence</p>
            <p className="mb-3">{preview.sentence}</p>
            <audio controls src={preview.audioUrl} />
          </section>
        )}

        {voices.length === 0 ? (
          <p className="font-serif text-foreground/60">No voices yet.</p>
        ) : (
          <ul className="space-y-4 font-serif">
            {voices.map((voice) => (
              <li
                key={voice.id}
                className="grid gap-3 border-y py-4 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <p className="text-xl">{voice.displayName}</p>
                  <p className="text-foreground/50">
                    {voice.mode} / cfg {voice.cfgValue} /{' '}
                    {voice.inferenceTimesteps} steps
                  </p>
                  <p className="text-foreground/50">{voice.id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={() => runValidation(voice.id)}>
                    Validate
                  </Button>
                  <Button type="button" onClick={() => runPreview(voice.id)}>
                    Preview
                  </Button>
                  <VoiceDialog
                    label="Edit"
                    voice={voice}
                    onSubmit={(form) => submitVoice(form, voice)}
                  />
                  <DeleteConfirmationDialog
                    title="Delete voice"
                    description={`Delete ${voice.displayName}? This is blocked if mappings exist unless force delete is used.`}
                    triggerLabel="Delete"
                    confirmLabel="Delete"
                    onConfirm={async () => {
                      await deleteVoiceFn({
                        data: { voiceId: voice.id, force: false },
                      })
                      await refreshVoices()
                    }}
                  />
                  <DeleteConfirmationDialog
                    title="Force delete voice"
                    description={`Force delete ${voice.displayName} and remove all document mappings that use it?`}
                    triggerLabel="Force Delete"
                    confirmLabel="Force Delete"
                    onConfirm={async () => {
                      await deleteVoiceFn({
                        data: { voiceId: voice.id, force: true },
                      })
                      await refreshVoices()
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function VoiceDialog({
  label,
  voice,
  onSubmit,
}: {
  label: string
  voice?: VoiceProfile
  onSubmit: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState(voice?.mode ?? 'designed')
  const title = useMemo(() => (voice ? 'Edit Voice' : 'New Voice'), [voice])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onSubmit(new FormData(event.currentTarget))
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">{label}</Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form className="mt-6 grid gap-4 font-serif" onSubmit={handleSubmit}>
          <label className="grid gap-2">
            <span>Name</span>
            <Input
              name="displayName"
              defaultValue={voice?.displayName ?? ''}
              required
              className="border-b bg-transparent px-1 border-orange-500"
            />
          </label>
          <label className="grid gap-2">
            <span>Mode</span>
            <Select
              name="mode"
              defaultValue={mode}
              onValueChange={(value: string) => setMode(value as typeof mode)}
              className="border-orange-500 w-full"
              options={[
                { value: 'designed', label: 'designed' },
                { value: 'clone', label: 'clone' },
                { value: 'hifi_clone', label: 'hifi clone' },
              ]}
            />
          </label>
          {mode === 'designed' && (
            <label className="grid gap-2">
              <span>Control text</span>
              <textarea
                name="controlText"
                defaultValue={voice?.controlText ?? ''}
                className="min-h-24 border bg-transparent p-2 border-orange-500 focus-visible:outline-none focus-visible:bg-orange-900/10"
              />
            </label>
          )}
          {mode === 'clone' && (
            <label className="grid gap-2">
              <span>Reference audio</span>
              <Input
                name="referenceAudio"
                type="file"
                accept=".wav,.mp3,.flac,.m4a,.ogg"
              />
            </label>
          )}
          {mode === 'hifi_clone' && (
            <>
              <label className="grid gap-2">
                <span>Prompt audio</span>
                <Input
                  name="promptAudio"
                  type="file"
                  accept=".wav,.mp3,.flac,.m4a,.ogg"
                />
              </label>
              <label className="grid gap-2">
                <span>Prompt text</span>
                <textarea
                  name="promptText"
                  defaultValue={voice?.promptText ?? ''}
                  className="min-h-24 border bg-transparent p-2 border-orange-500"
                />
              </label>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span>CFG</span>
              <Input
                name="cfgValue"
                type="number"
                min="0.1"
                max="10"
                step="0.1"
                defaultValue={voice?.cfgValue ?? 2}
                className="border-b bg-transparent px-1 border-orange-500"
              />
            </label>
            <label className="grid gap-2">
              <span>Inference steps</span>
              <Input
                name="inferenceTimesteps"
                type="number"
                min="1"
                max="100"
                defaultValue={voice?.inferenceTimesteps ?? 10}
                className="border-orange-500 border-b bg-transparent px-1"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              size="lg"
              className="bg-orange-500 text-orange-950 disabled:opacity-50 hover:bg-orange-500/70 hover:text-orange-950"
            >
              {voice ? 'Save Voice' : 'Create Voice'}
            </Button>
            <Button
              variant="ghost"
              type="button"
              size="lg"
              onClick={() => setOpen(false)}
              className="text-orange-500 border-orange-500 hover:bg-orange-500 hover:text-orange-950"
            >
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ValidationReport({ report }: { report: VoiceValidationReport }) {
  return (
    <section className="mb-6 border-y py-4 font-serif">
      <p>{report.valid ? 'valid' : 'invalid'}</p>
      {[...report.errors, ...report.warnings].map((issue) => (
        <p key={`${issue.code}-${issue.field}`} className="text-foreground/60">
          {issue.message}
        </p>
      ))}
    </section>
  )
}
