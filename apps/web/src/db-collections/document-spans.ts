import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { createCollection, useLiveQuery } from '@tanstack/react-db'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type { QueryClient } from '@tanstack/react-query'
import { listDocumentSpans } from '~/server/documents'

export const DocumentSpanSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  type: z.enum(['narration', 'dialogue']),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  speaker: z.string().nullable(),
  speakerConfidence: z.number().nullable(),
  needsReview: z.boolean().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type DocumentSpan = z.infer<typeof DocumentSpanSchema>

function documentSpansKey(bookSlug: string, documentId: string) {
  return ['document-spans', bookSlug, documentId] as const
}

function documentSpansMapKey(bookSlug: string, documentId: string) {
  return `${bookSlug}/${documentId}`
}

const documentSpanCollections = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof createDocumentSpansCollection>>
>()

function createDocumentSpansCollection(
  queryClient: QueryClient,
  bookSlug: string,
  documentId: string,
) {
  return createCollection(
    queryCollectionOptions({
      queryKey: documentSpansKey(bookSlug, documentId),
      queryFn: () => listDocumentSpans({ data: { bookSlug, documentId } }),
      queryClient,
      getKey: (span) => span.id,
      schema: DocumentSpanSchema,
      staleTime: 5_000,
    }),
  )
}

export function getDocumentSpansCollection(
  queryClient: QueryClient,
  bookSlug: string,
  documentId: string,
) {
  let collections = documentSpanCollections.get(queryClient)
  if (!collections) {
    collections = new Map()
    documentSpanCollections.set(queryClient, collections)
  }

  const key = documentSpansMapKey(bookSlug, documentId)
  let collection = collections.get(key)
  if (!collection) {
    collection = createDocumentSpansCollection(queryClient, bookSlug, documentId)
    collections.set(key, collection)
  }
  return collection
}

export function preloadDocumentSpans(
  queryClient: QueryClient,
  bookSlug: string,
  documentId: string,
) {
  return listDocumentSpans({ data: { bookSlug, documentId } }).then((spans) => {
    queryClient.setQueryData(documentSpansKey(bookSlug, documentId), spans)
    return getDocumentSpansCollection(
      queryClient,
      bookSlug,
      documentId,
    ).preload()
  })
}

export function useDocumentSpans(bookSlug: string, documentId: string) {
  const queryClient = useQueryClient()
  const documentSpansCollection = getDocumentSpansCollection(
    queryClient,
    bookSlug,
    documentId,
  )
  const { data: spans } = useLiveQuery(
    (q) =>
      q
        .from({ span: documentSpansCollection })
        .orderBy(({ span }) => span.start, 'asc')
        .orderBy(({ span }) => span.end, 'asc')
        .select(({ span }) => ({
          ...span,
        })),
    [documentSpansCollection],
  )

  return spans
}
