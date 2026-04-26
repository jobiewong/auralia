import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod/v4'
import { AudioUpload } from '~/components/audio-upload'
import { BracketButton } from '~/components/bracket-button'
import { LoadingEllipsis } from '~/components/loading-ellipsis'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { Slider } from '~/components/ui/slider'
import { Textarea } from '~/components/ui/textarea'
import type { Voice } from '~/db-collections'
import { getVoicesCollection, preloadVoices, useVoices } from '~/db-collections'
import { createVoicePreview } from '~/lib/voices-api'

export const Route = createFileRoute('/voices')({
  ssr: false,
  beforeLoad: ({ context }) => preloadVoices(context.queryClient),
  component: VoicesRoute,
})

const VoiceModeSchema = z.enum(['designed', 'clone', 'hifi_clone'])

type PreviewStatus = 'generating' | 'ready' | 'failed'

const voiceFormSchema = z.object({
  displayName: z.string().min(1),
  mode: VoiceModeSchema,
  controlText: z.string().optional(),
  referenceAudio: z.instanceof(File).optional(),
  promptAudio: z.instanceof(File).optional(),
  promptText: z.string().optional(),
  temperature: z.number().min(0.1).max(2.0).step(0.05),
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

function VoiceItem({
  voice,
  previewStatus,
  onEdit,
  onDelete,
  onForceDelete,
}: {
  voice: Voice
  previewStatus?: PreviewStatus
  onEdit: (values: z.infer<typeof voiceFormSchema>) => void | Promise<void>
  onDelete: () => void
  onForceDelete: () => void
}) {
  const [open, setOpen] = useState(false)

  const previewFileName = voice.previewAudioPath?.split('/').at(-1)
  const previewUrl = previewFileName
    ? `/api/voices/${voice.id}/preview-file/${previewFileName}`
    : null
  const isGeneratingPreview = previewStatus === 'generating'
  const previewFeedback =
    previewStatus === 'generating'
      ? null
      : previewStatus === 'ready'
        ? null
        : previewStatus === 'failed'
          ? 'Preview failed'
          : previewUrl
            ? null
            : 'No preview yet'

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="w-full text-left hover:bg-orange-950/10 py-1.5 px-2"
        asChild
      >
        <li
          key={voice.id}
          className="group grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div>
            <p className="flex items-center gap-2 leading-snug">
              {voice.displayName}
            </p>
            <p className="text-foreground/50">
              {voice.mode} / temperature {voice.temperature.toFixed(2)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {previewUrl && (
              <BracketButton onClick={() => setOpen(true)}>
                Preview
              </BracketButton>
            )}
            {(isGeneratingPreview || previewFeedback) && (
              <span
                role={isGeneratingPreview ? 'status' : undefined}
                aria-live="polite"
                className={
                  previewStatus === 'failed'
                    ? 'text-orange-500'
                    : 'text-foreground/50'
                }
              >
                {isGeneratingPreview ? (
                  <LoadingEllipsis>Generating preview</LoadingEllipsis>
                ) : (
                  previewFeedback
                )}
              </span>
            )}
            <VoiceDialog
              label="Edit"
              voice={voice}
              onSubmit={(values) => onEdit(values)}
            />
            <DeleteVoiceDialog
              voice={voice}
              onDelete={onDelete}
              onForceDelete={onForceDelete}
            />
          </div>
        </li>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section className="mb-6 border-b pb-2 font-serif px-2">
          <p className="mb-2">
            ↪Preview{' '}
            <span className="ml-2 text-foreground/50">
              -- {voice.previewSentence}
            </span>{' '}
          </p>
          <audio controls src={previewUrl ?? undefined} />
        </section>
      </CollapsibleContent>
    </Collapsible>
  )
}

function VoiceDialog({
  label,
  voice,
  onSubmit,
}: {
  label: string
  voice?: Voice
  onSubmit: (values: z.infer<typeof voiceFormSchema>) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const title = useMemo(() => (voice ? 'Edit Voice' : 'New Voice'), [voice])

  const form = useForm<z.infer<typeof voiceFormSchema>>({
    resolver: zodResolver(voiceFormSchema),
    defaultValues: {
      displayName: voice?.displayName ?? '',
      mode: voice?.mode ?? 'designed',
      controlText: voice?.controlText ?? '',
      referenceAudio: voice?.referenceAudioPath
        ? new File([], voice.referenceAudioPath)
        : undefined,
      promptAudio: voice?.promptAudioPath
        ? new File([], voice.promptAudioPath)
        : undefined,
      promptText: voice?.promptText ?? '',
      temperature: voice?.temperature ?? 0.9,
    },
  })

  const mode = form.watch('mode')
  const showTemperature = mode === 'designed' || mode === 'hifi_clone'

  async function handleSubmit(values: z.infer<typeof voiceFormSchema>) {
    await onSubmit(values)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {label === 'Edit' ? (
          <BracketButton
            onClick={(e) => {
              e.stopPropagation()
              setOpen(true)
            }}
          >
            {label}
          </BracketButton>
        ) : (
          <Button size="lg" variant="default">
            New Voice
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="w-full max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form className="mt-6" onSubmit={form.handleSubmit(handleSubmit)}>
          <FieldGroup>
            <Controller
              name="displayName"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field>
                  <FieldLabel htmlFor="displayName" className="grid gap-2">
                    Name
                  </FieldLabel>
                  <Input
                    {...field}
                    id="displayName"
                    aria-invalid={fieldState.invalid}
                    variant="dialog"
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />

            <Controller
              name="mode"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field>
                  <FieldLabel>Mode</FieldLabel>
                  <Select
                    {...field}
                    aria-invalid={fieldState.invalid}
                    className="border-orange-500"
                    options={[
                      { value: 'designed', label: 'designed' },
                      { value: 'clone', label: 'clone' },
                      { value: 'hifi_clone', label: 'hifi clone' },
                    ]}
                    onValueChange={(value) => {
                      field.onChange(
                        value as 'designed' | 'clone' | 'hifi_clone',
                      )
                    }}
                  />
                </Field>
              )}
            />
            {mode === 'designed' && (
              <>
                <Controller
                  name="controlText"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field>
                      <FieldLabel id="control-text">Control text</FieldLabel>
                      <Textarea
                        {...field}
                        id="control-text"
                        aria-invalid={fieldState.invalid}
                        className="min-h-24"
                      />
                      {fieldState.invalid ? (
                        <FieldError errors={[fieldState.error]} />
                      ) : null}
                    </Field>
                  )}
                />
              </>
            )}
            {showTemperature && (
              <Controller
                name="temperature"
                control={form.control}
                render={({ field, fieldState }) => {
                  const temperatureValue = Array.isArray(field.value)
                    ? (field.value[0] ?? 0.9)
                    : field.value

                  return (
                    <Field>
                      <div className="flex items-center justify-between gap-4">
                        <FieldLabel htmlFor="temperature">
                          Temperature
                        </FieldLabel>
                        <span className="font-mono text-sm text-orange-500/60">
                          {temperatureValue.toFixed(2)}
                        </span>
                      </div>
                      <div className="w-full flex items-center gap-2">
                        <Slider
                          id="temperature"
                          aria-invalid={fieldState.invalid}
                          className="w-full"
                          min={0.1}
                          max={2.0}
                          step={0.05}
                          name={field.name}
                          onBlur={field.onBlur}
                          value={[temperatureValue]}
                          onValueChange={(value) => {
                            field.onChange(value[0] ?? 0.9)
                          }}
                        />
                      </div>
                      {fieldState.invalid ? (
                        <FieldError errors={[fieldState.error]} />
                      ) : null}
                    </Field>
                  )
                }}
              />
            )}
            {mode === 'clone' && (
              <Controller
                name="referenceAudio"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel>Reference audio</FieldLabel>
                    <AudioUpload
                      files={field.value ? [field.value] : []}
                      setFiles={(nextFiles) => {
                        field.onChange(nextFiles[0] ?? undefined)
                      }}
                      onFileReject={() => {}}
                    />
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : null}
                  </Field>
                )}
              />
            )}
            {mode === 'hifi_clone' && (
              <>
                <Controller
                  name="promptAudio"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field>
                      <FieldLabel>Prompt audio</FieldLabel>
                      <AudioUpload
                        files={field.value ? [field.value] : []}
                        setFiles={(nextFiles) => {
                          field.onChange(nextFiles[0] ?? undefined)
                        }}
                        onFileReject={() => {}}
                      />
                      {fieldState.invalid ? (
                        <FieldError errors={[fieldState.error]} />
                      ) : null}
                    </Field>
                  )}
                />
                <Controller
                  name="promptText"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field>
                      <FieldLabel id="prompt-text">
                        Prompt transcript
                      </FieldLabel>
                      <Textarea
                        {...field}
                        id="prompt-text"
                        aria-invalid={fieldState.invalid}
                        className="min-h-24"
                      />
                      {fieldState.invalid ? (
                        <FieldError errors={[fieldState.error]} />
                      ) : null}
                    </Field>
                  )}
                />
              </>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" variant="confirm" size="lg">
              {voice ? 'Save Voice' : 'Create Voice'}
            </Button>
            <Button
              variant="cancel"
              type="button"
              size="lg"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteVoiceDialog({
  voice,
  onDelete,
  onForceDelete,
}: {
  voice: Voice
  onDelete: () => void
  onForceDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [forceDelete, setForceDelete] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <BracketButton
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
        >
          Delete
        </BracketButton>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Voice</DialogTitle>
          <DialogDescription className="">
            Delete {voice.displayName}? This is blocked if mappings exist unless
            force delete is used.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-6">
          <Field orientation="horizontal">
            <Checkbox
              id="force-delete"
              onCheckedChange={(e) =>
                setForceDelete(e === 'indeterminate' ? false : e)
              }
            />
            <FieldLabel htmlFor="force-delete">Force delete</FieldLabel>
          </Field>
        </div>
        <DialogFooter className="mt-4">
          <Button
            variant="confirm"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              if (forceDelete) {
                onForceDelete()
              } else {
                onDelete()
              }
            }}
            size="lg"
          >
            Delete
          </Button>
          <DialogClose asChild>
            <Button
              variant="cancel"
              size="lg"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
              }}
            >
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
