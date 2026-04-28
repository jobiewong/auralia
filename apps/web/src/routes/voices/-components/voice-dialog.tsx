import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod/v4'
import { AudioUpload } from '~/components/audio-upload'
import { BracketButton } from '~/components/bracket-button'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
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

export const VoiceModeSchema = z.enum(['designed', 'clone', 'hifi_clone'])

export type PreviewStatus = 'generating' | 'ready' | 'failed'

export const voiceFormSchema = z.object({
  displayName: z.string().min(1),
  mode: VoiceModeSchema,
  controlText: z.string().optional(),
  referenceAudio: z.instanceof(File).optional(),
  promptAudio: z.instanceof(File).optional(),
  promptText: z.string().optional(),
  temperature: z.number().min(0.1).max(2.0).step(0.05),
})

export function VoiceDialog({
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
