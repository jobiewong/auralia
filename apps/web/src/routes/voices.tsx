import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod/v4'
import { AudioUpload } from '~/components/audio-upload'
import { BracketButton } from '~/components/bracket-button'
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
import { Textarea } from '~/components/ui/textarea'
import { preloadVoices, useVoices } from '~/db-collections'
import type { VoiceProfile } from '~/db/voices'
import { createVoice, deleteVoice, updateVoice } from '~/db/voices'

export const Route = createFileRoute('/voices')({
  ssr: false,
  beforeLoad: ({ context }) => preloadVoices(context.queryClient),
  component: VoicesRoute,
})

const VoiceModeSchema = z.enum(['designed', 'clone', 'hifi_clone'])

const voiceFormSchema = z.object({
  displayName: z.string().min(1),
  mode: VoiceModeSchema,
  controlText: z.string().optional(),
  referenceAudio: z.instanceof(File).optional(),
  promptAudio: z.instanceof(File).optional(),
  promptText: z.string().optional(),
  cfgValue: z.number().min(0.1).max(10).step(0.1),
  inferenceTimesteps: z.number().min(1).max(100),
})

function VoicesRoute() {
  const queryClient = useQueryClient()
  const createVoiceFn = useServerFn(createVoice)
  const updateVoiceFn = useServerFn(updateVoice)
  const deleteVoiceFn = useServerFn(deleteVoice)
  const [error, setError] = useState<string | null>(null)
  const voices = useVoices() ?? []

  async function submitVoice(
    values: z.infer<typeof voiceFormSchema>,
    voice?: VoiceProfile,
  ) {
    setError(null)
    const formData = new FormData()
    formData.append('displayName', values.displayName)
    formData.append('mode', values.mode)
    formData.append('controlText', values.controlText ?? '')
    formData.append('referenceAudio', values.referenceAudio ?? '')
    formData.append('promptAudio', values.promptAudio ?? '')
    formData.append('promptText', values.promptText ?? '')
    formData.append('cfgValue', values.cfgValue.toString())
    formData.append('inferenceTimesteps', values.inferenceTimesteps.toString())

    try {
      if (voice) {
        formData.append('voiceId', voice.id)
        await updateVoiceFn({ data: formData })
      } else {
        await createVoiceFn({ data: formData })
      }
      await queryClient.invalidateQueries({ queryKey: ['voices'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice save failed')
      throw err
    }
  }

  async function handleDelete(voiceId: string, force: boolean) {
    setError(null)
    const prev = queryClient.getQueryData<VoiceProfile[]>(['voices'])
    queryClient.setQueryData<VoiceProfile[]>(['voices'], (data) =>
      (data ?? []).filter((v) => v.id !== voiceId),
    )
    try {
      await deleteVoiceFn({ data: { voiceId, force } })
      await queryClient.invalidateQueries({ queryKey: ['voices'] })
    } catch (err) {
      queryClient.setQueryData(['voices'], prev)
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
  onEdit,
  onDelete,
  onForceDelete,
}: {
  voice: VoiceProfile
  onEdit: (values: z.infer<typeof voiceFormSchema>) => void
  onDelete: () => void
  onForceDelete: () => void
}) {
  const [open, setOpen] = useState(false)

  const previewFileName = voice.previewAudioPath?.split('/').at(-1)
  const previewUrl = previewFileName
    ? `/api/voices/${voice.id}/preview-file/${previewFileName}`
    : null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <li>
        <CollapsibleTrigger className="w-full text-left hover:bg-orange-950/10 py-1.5 px-2">
          <li
            key={voice.id}
            className="group grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div>
              <p className="flex items-center gap-2 leading-snug">
                {voice.displayName}
              </p>
              <p className="text-foreground/50">
                {voice.mode} / cfg {voice.cfgValue} / {voice.inferenceTimesteps}{' '}
                steps
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {previewUrl && (
                <BracketButton onClick={() => setOpen(true)}>
                  Preview
                </BracketButton>
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
          <section className="mb-6 border-y py-4 font-serif">
            <p className="text-foreground/50">Preview sentence</p>
            <p className="mb-3">{voice.previewSentence}</p>
            <audio controls src={previewUrl ?? undefined} />
          </section>
        </CollapsibleContent>
      </li>
    </Collapsible>
  )
}

function VoiceDialog({
  label,
  voice,
  onSubmit,
}: {
  label: string
  voice?: VoiceProfile
  onSubmit: (values: z.infer<typeof voiceFormSchema>) => void
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
      cfgValue: voice?.cfgValue ?? 2,
      inferenceTimesteps: voice?.inferenceTimesteps ?? 10,
    },
  })

  const mode = form.watch('mode')

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
                  />
                </Field>
              )}
            />
            {mode === 'designed' && (
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
            )}
            {/* <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span>CFG</span>
              <Input
                name="cfgValue"
                type="number"
                min="0.1"
                max="10"
                step="0.1"
                defaultValue={voice?.cfgValue ?? 2}
                variant="underline"
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
                variant="underline"
              />
            </label>
          </div>*/}
          </FieldGroup>
          <DialogFooter>
            <Button
              type="submit"
              variant="confirm"
              size="lg"
              onClick={(e) => {
                e.stopPropagation()
                form.handleSubmit(handleSubmit)()
              }}
            >
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
  voice: VoiceProfile
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
