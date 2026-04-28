import { useServerFn } from '@tanstack/react-start'
import { DeleteConfirmationDialog } from '~/components/delete-confirmation-dialog'
import { deleteCastCharacter, updateCastCharacter } from '~/server/documents'
import { formatCount } from '~/lib/utils'
import { useVoiceAssignment } from '~/hooks/use-voice-assignment'
import { CastFormDialog, type CastFormState } from './cast-form-dialog'
import { CastVoiceEditor } from './cast-voice-editor'

interface CastCharacter {
  canonicalName: string
  aliases: string[]
  descriptor: string | null
}

function parseAliases(value: string) {
  return value
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean)
}

function getCastPayload(documentId: string, form: CastFormState) {
  return {
    documentId,
    canonicalName: form.canonicalName,
    aliases: parseAliases(form.aliases),
    descriptor: form.descriptor.trim() || null,
  }
}

export function CastRow({
  character,
  speakerCounts,
  documentId,
  bookSlug,
}: {
  character: CastCharacter
  speakerCounts: Map<string, number>
  documentId: string
  bookSlug: string
}) {
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
    <li className="flex items-center justify-between">
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
