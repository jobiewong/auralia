import { queryCollectionOptions } from '@tanstack/query-db-collection'
import {
  createCollection,
  localOnlyCollectionOptions,
  useLiveQuery,
} from '@tanstack/react-db'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  getDocumentDiagnostics,
  listDocumentSpans,
  listWorkDocuments,
} from '~/db/documents'
import { listVoices } from '~/db/voices'
import { listWorks } from '~/db/works'

import type { QueryClient } from '@tanstack/react-query'

const VoiceSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  mode: z.enum(['designed', 'clone', 'hifi_clone']),
  controlText: z.string().nullable(),
  referenceAudioPath: z.string().nullable(),
  promptAudioPath: z.string().nullable(),
  promptText: z.string().nullable(),
  cfgValue: z.number(),
  inferenceTimesteps: z.number(),
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
      queryFn: () => listVoices(),
      queryClient,
      getKey: (voice) => voice.id,
      schema: VoiceSchema,
      staleTime: 5_000,
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
  return listVoices().then((voices) => {
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
  speaker: z.string().nullable(),
  speakerConfidence: z.number().nullable(),
  needsReview: z.boolean().nullable(),
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

function documentDiagnosticsKey(bookSlug: string, documentId: string) {
  return ['document-diagnostics', bookSlug, documentId] as const
}

export function preloadDocumentDiagnostics(
  queryClient: QueryClient,
  bookSlug: string,
  documentId: string,
) {
  return queryClient.ensureQueryData({
    queryKey: documentDiagnosticsKey(bookSlug, documentId),
    queryFn: () => getDocumentDiagnostics({ data: { bookSlug, documentId } }),
    staleTime: 5_000,
  })
}

export function useDocumentDiagnostics(bookSlug: string, documentId: string) {
  const { data: diagnostics } = useQuery({
    queryKey: documentDiagnosticsKey(bookSlug, documentId),
    queryFn: () => getDocumentDiagnostics({ data: { bookSlug, documentId } }),
    staleTime: 5_000,
    refetchInterval: (query) =>
      hasActivePipelineJob(query.state.data) ? 1_000 : false,
  })

  return diagnostics
}

function hasActivePipelineJob(diagnostics: unknown) {
  if (!diagnostics || typeof diagnostics !== 'object') {
    return false
  }

  return [
    'latestIngestionJob',
    'latestSegmentationJob',
    'latestCastDetectionJob',
    'latestAttributionJob',
    'latestSynthesisJob',
  ].some((key) => {
    const job = (diagnostics as Record<string, unknown>)[key]
    return (
      job &&
      typeof job === 'object' &&
      ['pending', 'running'].includes(
        String((job as { status?: unknown }).status),
      )
    )
  })
}
