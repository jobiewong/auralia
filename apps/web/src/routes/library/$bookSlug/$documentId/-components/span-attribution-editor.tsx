import { useState } from 'react'
import { BracketButton } from '~/components/bracket-button'
import type { ComboboxOption } from '~/components/ui/combobox-custom'
import { Combobox } from '~/components/ui/combobox-custom'
import type { DocumentSpan } from '~/db-collections'

export function SpanAttributionEditor({
  span,
  speakerOptions,
  onSave,
}: {
  span: DocumentSpan
  speakerOptions: ComboboxOption[]
  onSave: (data: {
    spanId: string
    speaker: string
    needsReview: boolean
  }) => Promise<void>
}) {
  const [speaker, setSpeaker] = useState(span.speaker ?? 'UNKNOWN')
  const [isSaving, setIsSaving] = useState(false)

  async function save(nextSpeaker = speaker, needsReview = false) {
    setIsSaving(true)
    try {
      await onSave({
        spanId: span.id,
        speaker: nextSpeaker,
        needsReview,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-foreground/70"
      onClick={(event) => event.stopPropagation()}
    >
      <span>speaker:</span>
      <Combobox
        value={speaker}
        options={speakerOptions}
        searchPlaceholder="Search speakers"
        allowCustom
        onValueChange={setSpeaker}
      />
      <BracketButton disabled={isSaving} onClick={() => save()}>
        Save
      </BracketButton>
    </div>
  )
}
