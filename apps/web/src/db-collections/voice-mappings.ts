import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { createCollection, useLiveQuery } from '@tanstack/react-db'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type { QueryClient } from '@tanstack/react-query'
import {
  clearVoiceMapping,
  fetchDocumentVoiceMappings,
  upsertVoiceMapping,
} from '~/lib/voices-api'

export const VoiceMappingSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  speaker: z.string(),
  voiceId: z.string(),
  voiceName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type VoiceMapping = z.infer<typeof VoiceMappingSchema>

function documentVoiceMappingsKey(documentId: string) {
  return ['document-voice-mappings', documentId] as const
}

const documentVoiceMappingCollections = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof createDocumentVoiceMappingsCollection>>
>()

function createDocumentVoiceMappingsCollection(
  queryClient: QueryClient,
  documentId: string,
) {
  return createCollection(
    queryCollectionOptions({
      queryKey: documentVoiceMappingsKey(documentId),
      queryFn: () => fetchDocumentVoiceMappings(documentId),
      queryClient,
      getKey: (mapping) => mapping.speaker,
      schema: VoiceMappingSchema,
      staleTime: 5_000,
      onInsert: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map((mutation) =>
            upsertVoiceMapping(documentId, {
              speaker: mutation.modified.speaker,
              voiceId: mutation.modified.voiceId,
            }),
          ),
        )
      },
      onUpdate: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map((mutation) =>
            upsertVoiceMapping(documentId, {
              speaker: String(mutation.key),
              voiceId: mutation.modified.voiceId,
            }),
          ),
        )
      },
      onDelete: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map((mutation) =>
            clearVoiceMapping(documentId, String(mutation.key)),
          ),
        )
      },
    }),
  )
}

export function getDocumentVoiceMappingsCollection(
  queryClient: QueryClient,
  documentId: string,
) {
  let collections = documentVoiceMappingCollections.get(queryClient)
  if (!collections) {
    collections = new Map()
    documentVoiceMappingCollections.set(queryClient, collections)
  }

  let collection = collections.get(documentId)
  if (!collection) {
    collection = createDocumentVoiceMappingsCollection(queryClient, documentId)
    collections.set(documentId, collection)
  }
  return collection
}

export function useDocumentVoiceMappings(documentId: string) {
  const queryClient = useQueryClient()
  const mappingsCollection = getDocumentVoiceMappingsCollection(
    queryClient,
    documentId,
  )
  const { data: mappings } = useLiveQuery(
    (q) =>
      q
        .from({ mapping: mappingsCollection })
        .orderBy(({ mapping }) => mapping.speaker, 'asc')
        .select(({ mapping }) => ({ ...mapping })),
    [mappingsCollection],
  )
  return mappings
}
