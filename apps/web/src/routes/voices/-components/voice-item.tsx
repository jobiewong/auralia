import { useState } from 'react'
import { z } from 'zod/v4'
import { BracketButton } from '~/components/bracket-button'
import { LoadingEllipsis } from '~/components/loading-ellipsis'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import type { Voice } from '~/db-collections'
import { DeleteVoiceDialog } from './delete-voice-dialog'
import { VoiceDialog, voiceFormSchema, type PreviewStatus } from './voice-dialog'

export function VoiceItem({
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
