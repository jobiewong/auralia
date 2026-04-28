import { useEffect, useState } from 'react'
import { BracketButton } from '~/components/bracket-button'
import type { ComboboxOption } from '~/components/ui/combobox-custom'
import { Combobox } from '~/components/ui/combobox-custom'

export function CastVoiceEditor({
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
