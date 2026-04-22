import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { DeleteConfirmationDialog } from '~/components/delete-confirmation-dialog'
import { ArrowLeft } from '~/components/icons/arrow-left'
import {
  preloadBookDocuments,
  preloadBooks,
  preloadDocumentSpans,
  useBookDocuments,
  useBooks,
  useDocumentSpans,
} from '~/db-collections'
import { deleteDocument } from '~/db/documents'

export const Route = createFileRoute('/library/$bookSlug/$documentId/')({
  ssr: false,
  beforeLoad: ({ context, params }) =>
    Promise.all([
      preloadBooks(context.queryClient),
      preloadBookDocuments(context.queryClient, params.bookSlug),
      preloadDocumentSpans(
        context.queryClient,
        params.bookSlug,
        params.documentId,
      ),
    ]),
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug, documentId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const deleteDocumentFn = useServerFn(deleteDocument)
  const books = useBooks()
  const chapters = useBookDocuments(bookSlug)
  const spans = useDocumentSpans(bookSlug, documentId)
  const book = books.find((item) => item.slug === bookSlug)
  const chapter = chapters.find((item) => item.id === documentId)

  if (!book || !chapter) {
    return (
      <main className="page-wrap">
        <section className="px-6 py-10 sm:px-10 sm:py-14">
          <p className="mb-4 font-serif text-xl">Library</p>
          <h1 className="mb-8 text-4xl leading-tight font-black sm:text-6xl font-display">
            Chapter not found
          </h1>
          <Link
            to="/library/$bookSlug"
            params={{ bookSlug }}
            className="font-serif text-xl hover:underline"
          >
            Back to book
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="page-wrap">
      <section className="px-6 py-10 sm:px-10 sm:py-14">
        <p className="mb-4 font-serif text-xl text-foreground/50">
          <Link to="/library" className="hover:underline">
            Library
          </Link>{' '}
          /{' '}
          <Link
            to="/library/$bookSlug"
            params={{ bookSlug: book.slug }}
            className="hover:underline"
          >
            {book.title}
          </Link>{' '}
          / {chapter.chapterId}
        </p>
        <h1 className="display-title mb-8">
          {chapter.title || chapter.chapterId}
        </h1>
        <dl className="grid max-w-4xl gap-2 border-y py-5 font-serif sm:grid-cols-[12rem_1fr]">
          <dt className="text-foreground/50">Book</dt>
          <dd>{book.title}</dd>
          <dt className="text-foreground/50">Document</dt>
          <dd>{chapter.id}</dd>
          <dt className="text-foreground/50">Spans</dt>
          <dd>{formatSpanCount(spans.length)}</dd>
          <dt className="text-foreground/50">Length</dt>
          <dd>{formatTextLength(chapter.textLength)}</dd>
          <dt className="text-foreground/50">Updated</dt>
          <dd>{formatDate(chapter.updatedAt)}</dd>
        </dl>
      </section>

      <section className="px-6 pb-8 sm:px-10">
        <div className="mb-10 flex flex-wrap justify-between gap-4">
          <Link
            to="/library/$bookSlug"
            params={{ bookSlug: book.slug }}
            className="nav-link"
          >
            <ArrowLeft className="size-6" />
            Back to Book
          </Link>
          <DeleteConfirmationDialog
            className="rounded-full border border-orange-900 px-4! py-2! w-fit font-serif text-xl transition-colors duration-150 ease-in-out hover:border-orange-950 hover:bg-orange-950 hover:text-orange-500 hover:no-underline"
            title="Delete chapter"
            description={`Delete ${chapter.title || chapter.chapterId} and all associated spans, jobs, and mappings? This cannot be undone.`}
            triggerLabel="Delete Chapter"
            confirmLabel="Delete Chapter"
            onConfirm={async () => {
              await deleteDocumentFn({ data: { documentId: chapter.id } })
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['books'] }),
                queryClient.invalidateQueries({
                  queryKey: ['book-documents', book.slug],
                }),
                queryClient.invalidateQueries({
                  queryKey: ['document-spans', book.slug, chapter.id],
                }),
              ])
              await navigate({
                to: '/library/$bookSlug',
                params: { bookSlug: book.slug },
              })
            }}
          />
        </div>
        {spans.length === 0 ? (
          <p className="font-serif text-foreground/50">No spans yet.</p>
        ) : (
          <ol className="space-y-3">
            {spans.map((span, index) => (
              <li
                key={span.id}
                className="grid gap-2 font-serif sm:grid-cols-[4rem_9rem_minmax(0,1fr)_auto] sm:items-baseline"
              >
                <p className="text-foreground/50">
                  {String(index + 1).padStart(2, '0')}
                </p>
                <p className="text-foreground/50">{span.type}</p>
                <div>
                  <p className="leading-tight">{span.text}</p>
                  <p className="text-foreground/50">
                    {span.start}-{span.end} /{' '}
                    {formatTextLength(span.end - span.start)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function formatTextLength(textLength: number) {
  return `${new Intl.NumberFormat('en-GB').format(textLength)} chars`
}

function formatSpanCount(spanCount: number) {
  const label = spanCount === 1 ? 'span' : 'spans'
  return `${new Intl.NumberFormat('en-GB').format(spanCount)} ${label}`
}
