import { queryCollectionOptions } from '@tanstack/query-db-collection'
import {
  createCollection,
  localOnlyCollectionOptions,
  useLiveQuery,
} from '@tanstack/react-db'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { listDocumentSpans, listWorkDocuments } from '~/db/documents'
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
  sourceMetadata: z.string().nullable(),
})

export type Book = z.infer<typeof BookSchema>

const BookDocumentSchema = z.object({
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

const DocumentSpanSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  type: z.enum(['narration', 'dialogue']),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type DocumentSpan = z.infer<typeof DocumentSpanSchema>

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
const bookDocumentCollections = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof createBookDocumentsCollection>>
>()
const documentSpanCollections = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof createDocumentSpansCollection>>
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

  return books 
}

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

function documentSpansKey(bookSlug: string, documentId: string) {
  return ['document-spans', bookSlug, documentId] as const
}

function documentSpansMapKey(bookSlug: string, documentId: string) {
  return `${bookSlug}/${documentId}`
}

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
