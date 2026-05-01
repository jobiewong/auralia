import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { createCollection, useLiveQuery } from '@tanstack/react-db'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type { QueryClient } from '@tanstack/react-query'
import { listWorkDocuments } from '~/server/documents'

export const BookDocumentSchema = z.object({
  id: z.string(),
  workId: z.string().nullable(),
  sourceId: z.string(),
  chapterId: z.string(),
  title: z.string().nullable(),
  textLength: z.number(),
  sourceMetadata: z.string().nullable(),
  spanCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type BookDocument = z.infer<typeof BookDocumentSchema>

const bookDocumentCollections = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof createBookDocumentsCollection>>
>()

function createBookDocumentsCollection(
  queryClient: QueryClient,
  bookSlug: string,
) {
  return createCollection(
    queryCollectionOptions({
      queryKey: ['book-documents', bookSlug],
      queryFn: () => listWorkDocuments({ data: { bookSlug } }),
      queryClient,
      getKey: (document) => document.id,
      schema: BookDocumentSchema,
      staleTime: 5_000,
    }),
  )
}

export function getBookDocumentsCollection(
  queryClient: QueryClient,
  bookSlug: string,
) {
  let collections = bookDocumentCollections.get(queryClient)
  if (!collections) {
    collections = new Map()
    bookDocumentCollections.set(queryClient, collections)
  }

  let collection = collections.get(bookSlug)
  if (!collection) {
    collection = createBookDocumentsCollection(queryClient, bookSlug)
    collections.set(bookSlug, collection)
  }
  return collection
}

export function preloadBookDocuments(
  queryClient: QueryClient,
  bookSlug: string,
) {
  return listWorkDocuments({ data: { bookSlug } }).then((documents) => {
    queryClient.setQueryData(['book-documents', bookSlug], documents)
    return getBookDocumentsCollection(queryClient, bookSlug).preload()
  })
}

export function useBookDocuments(bookSlug: string) {
  const queryClient = useQueryClient()
  const bookDocumentsCollection = getBookDocumentsCollection(
    queryClient,
    bookSlug,
  )
  const { data: documents } = useLiveQuery(
    (q) =>
      q
        .from({ document: bookDocumentsCollection })
        .orderBy(({ document }) => document.createdAt, 'asc')
        .orderBy(({ document }) => document.chapterId, 'asc')
        .select(({ document }) => ({
          ...document,
        })),
    [bookDocumentsCollection],
  )

  return documents
}
