import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { createCollection, useLiveQuery } from '@tanstack/react-db'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type { QueryClient } from '@tanstack/react-query'
import type { VoiceFormValues } from '~/lib/voices-api'
import {
  createVoice,
  deleteVoice,
  fetchVoices,
  updateVoice,
} from '~/lib/voices-api'

export const VoiceSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  mode: z.enum(['designed', 'clone', 'hifi_clone']),
  controlText: z.string().nullable(),
  referenceAudioPath: z.string().nullable(),
  promptAudioPath: z.string().nullable(),
  promptText: z.string().nullable(),
  temperature: z.number(),
  isCanonical: z.boolean(),
  previewAudioPath: z.string().nullable(),
  previewSentence: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Voice = z.infer<typeof VoiceSchema>

const voiceCollections = new WeakMap<
  QueryClient,
  ReturnType<typeof createVoicesCollection>
>()

function createVoicesCollection(queryClient: QueryClient) {
  return createCollection(
    queryCollectionOptions({
      queryKey: ['voices'],
      queryFn: () => fetchVoices(),
      queryClient,
      getKey: (voice) => voice.id,
      schema: VoiceSchema,
      staleTime: 5_000,
      onInsert: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map((mutation) =>
            createVoice({
              ...(mutation.metadata as VoiceFormValues),
              voiceId: mutation.modified.id,
            }),
          ),
        )
      },
      onUpdate: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map((mutation) =>
            updateVoice(
              String(mutation.key),
              mutation.metadata as VoiceFormValues,
            ),
          ),
        )
      },
      onDelete: async ({ transaction }) => {
        await Promise.all(
          transaction.mutations.map((mutation) =>
            deleteVoice(String(mutation.key), {
              force:
                typeof mutation.metadata === 'object' &&
                mutation.metadata !== null &&
                'force' in mutation.metadata &&
                mutation.metadata.force === true,
            }),
          ),
        )
      },
    }),
  )
}

export function getVoicesCollection(queryClient: QueryClient) {
  let collection = voiceCollections.get(queryClient)
  if (!collection) {
    collection = createVoicesCollection(queryClient)
    voiceCollections.set(queryClient, collection)
  }
  return collection
}

export function preloadVoices(queryClient: QueryClient) {
  return fetchVoices().then((voices) => {
    queryClient.setQueryData(['voices'], voices)
    return getVoicesCollection(queryClient).preload()
  })
}

export function useVoices() {
  const queryClient = useQueryClient()
  const voicesCollection = getVoicesCollection(queryClient)
  const { data: voices } = useLiveQuery(
    (q) =>
      q
        .from({ voice: voicesCollection })
        .orderBy(({ voice }) => voice.displayName, 'asc')
        .select(({ voice }) => ({ ...voice })),
    [voicesCollection],
  )
  return voices
}
