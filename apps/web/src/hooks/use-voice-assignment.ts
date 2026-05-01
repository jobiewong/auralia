import { useQueryClient } from '@tanstack/react-query'
import {
  getDocumentVoiceMappingsCollection,
  useDocumentVoiceMappings,
  useVoices,
} from '~/db-collections'

function getVoiceOptions(voices: Array<{ id: string; displayName: string }>) {
  return [
    { value: '', label: 'Unmapped' },
    ...voices.map((voice) => ({
      value: voice.id,
      label: voice.displayName,
    })),
  ]
}

export function useVoiceAssignment({
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
