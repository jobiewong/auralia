import { queryCollectionOptions } from '@tanstack/query-db-collection'
import {
  createCollection,
  localOnlyCollectionOptions,
  useLiveQuery,
} from '@tanstack/react-db'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { listWorks } from '~/db/works'

import type { QueryClient } from '@tanstack/react-query'

const BookSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  authors: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Book = z.infer<typeof BookSchema>

const MessageSchema = z.object({
  id: z.number(),
  text: z.string(),
  user: z.string(),
})

export type Message = z.infer<typeof MessageSchema>

export const messagesCollection = createCollection(
  localOnlyCollectionOptions({
    getKey: (message) => message.id,
    schema: MessageSchema,
  }),
)

const bookCollections = new WeakMap<
  QueryClient,
  ReturnType<typeof createBooksCollection>
>()

function createBooksCollection(queryClient: QueryClient) {
  return createCollection(
    queryCollectionOptions({
      queryKey: ['books'],
      queryFn: () => listWorks(),
      queryClient,
      getKey: (book) => book.id,
      schema: BookSchema,
      staleTime: 5_000,
    }),
  )
}

export function getBooksCollection(queryClient: QueryClient) {
  let collection = bookCollections.get(queryClient)
  if (!collection) {
    collection = createBooksCollection(queryClient)
    bookCollections.set(queryClient, collection)
  }
  return collection
}

export function preloadBooks(queryClient: QueryClient) {
  return listWorks().then((books) => {
    queryClient.setQueryData(['books'], books)
    return getBooksCollection(queryClient).preload()
  })
}

export function useBooks() {
  const queryClient = useQueryClient()
  const booksCollection = getBooksCollection(queryClient)
  const { data: books } = useLiveQuery(
    (q) =>
      q
        .from({ book: booksCollection })
        .orderBy(({ book }) => book.updatedAt, 'desc')
        .select(({ book }) => ({
          ...book,
        })),
    [booksCollection],
  )

  return books ?? []
}
