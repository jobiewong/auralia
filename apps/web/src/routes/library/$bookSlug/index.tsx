import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { DeleteConfirmationDialog } from '~/components/delete-confirmation-dialog'
import {
  preloadBookDocuments,
  preloadBooks,
  useBookDocuments,
  useBooks,
} from '~/db-collections'
import { deleteDocument } from '~/db/documents'
import { deleteWork } from '~/db/works'
import { cn, parseWorkSourceMetadata } from '~/lib/utils'

export const Route = createFileRoute('/library/$bookSlug/')({
  ssr: false,
  beforeLoad: ({ context, params }) =>
    Promise.all([
      preloadBooks(context.queryClient),
      preloadBookDocuments(context.queryClient, params.bookSlug),
    ]),
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const deleteDocumentFn = useServerFn(deleteDocument)
  const deleteWorkFn = useServerFn(deleteWork)
  const books = useBooks()
  const chapters = useBookDocuments(bookSlug)
  const book = books.find((item) => item.slug === bookSlug)

  const metadata = parseWorkSourceMetadata(book?.sourceMetadata ?? null)

  if (!book) {
    return (
      <main className="page-wrap">
        <section className="px-6 py-10 sm:px-10 sm:py-14">
          <p className="mb-4 font-serif text-xl">Library</p>
          <h1 className="mb-8 text-4xl leading-tight font-black sm:text-6xl font-display">
            Book not found
          </h1>
          <Link to="/library" className="font-serif text-xl hover:underline">
            Back to library
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="page-wrap">
      <section className="px-6 py-10 sm:px-10 sm:py-14">
        <div className="mb-4 flex items-center gap-8 font-serif text-xl">
          <p className="text-foreground/50">
            <Link to="/library" className="hover:underline">
              Library
            </Link>{' '}
            / {book.sourceType} / updated {formatDate(book.updatedAt)}
          </p>
        </div>
        <h1 className="display-title mb-8">{book.title}</h1>
        <dl className="grid max-w-4xl gap-2 border-y py-5 font-serif sm:grid-cols-[12rem_1fr] [&>dt]:text-foreground/50">
          <dt>Source</dt>
          <dd>
            {metadata?.source === 'ao3' ? (
              <a
                href={`https://archiveofourown.org/works/${metadata.work_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {book.sourceId}
              </a>
            ) : (
              book.sourceId
            )}
          </dd>
          <dt>Author(s)</dt>
          <dd>
            {metadata?.authors.map((author, ci) => (
              <Link to={author.url} className="hover:underline">
                {author.name}
                {ci < metadata.authors.length - 1 ? ', ' : ''}
              </Link>
            ))}
          </dd>
          <dt>Chapters</dt>
          <dd>{chapters.length}</dd>
          <dt>Created</dt>
          <dd>{formatDate(book.createdAt)}</dd>
        </dl>
      </section>

      <section className="px-6 pb-8 sm:px-10">
        <nav className="flex flex-wrap content-start gap-4 mb-10">
          <BookAction
            to="/library/$bookSlug"
            slug={book.slug}
            className="bg-orange-950 text-orange-500"
          >
            Overview
          </BookAction>
          <BookAction to="/library/$bookSlug/pipeline" slug={book.slug}>
            Pipeline
          </BookAction>
          <BookAction to="/library/$bookSlug/text" slug={book.slug}>
            Text
          </BookAction>
          <BookAction to="/library/$bookSlug/review" slug={book.slug}>
            Review
          </BookAction>
          <BookAction to="/library/$bookSlug/cast" slug={book.slug}>
            Cast
          </BookAction>
          <BookAction to="/library/$bookSlug/voice-map" slug={book.slug}>
            Voice Map
          </BookAction>
          <BookAction to="/library/$bookSlug/synthesis" slug={book.slug}>
            Synthesis
          </BookAction>
          <DeleteConfirmationDialog
            className="ml-auto rounded-full border border-orange-900 px-4! py-2! w-fit font-serif text-xl transition-colors duration-150 ease-in-out hover:border-orange-950 hover:bg-orange-950 hover:text-orange-500 hover:no-underline"
            title="Delete work"
            description={`Delete ${book.title} and all associated chapters, spans, jobs, and mappings? This cannot be undone.`}
            triggerLabel="Delete Work"
            confirmLabel="Delete Work"
            onConfirm={async () => {
              await deleteWorkFn({ data: { workId: book.id } })
              await queryClient.invalidateQueries({ queryKey: ['books'] })
              await navigate({ to: '/library' })
            }}
          />
        </nav>
        <div>
          {chapters.length === 0 ? (
            <p className="font-serif text-foreground/50">No chapters yet.</p>
          ) : (
            <ol className="space-y-2">
              {chapters.map((chapter, index) => (
                <li
                  key={chapter.id}
                  className="grid gap-2 font-serif sm:grid-cols-[4rem_1fr_auto_auto] sm:items-baseline"
                >
                  <p className="text-foreground/50">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <div>
                    <Link
                      to="/library/$bookSlug/$documentId"
                      params={{ bookSlug: book.slug, documentId: chapter.id }}
                      className="leading-tight hover:underline"
                    >
                      {chapter.title || chapter.chapterId}
                    </Link>
                    <p className="text-foreground/50">
                      {chapter.chapterId} /{' '}
                      {formatTextLength(chapter.textLength)} /{' '}
                      {formatSpanCount(chapter.spanCount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-base text-foreground/50">
                      updated {formatDate(chapter.updatedAt)}
                    </p>
                    <DeleteConfirmationDialog
                      title="Delete chapter"
                      description={`Delete ${chapter.title || chapter.chapterId} and all associated spans, jobs, and mappings? This cannot be undone.`}
                      triggerLabel="Delete"
                      confirmLabel="Delete Chapter"
                      onConfirm={async () => {
                        await deleteDocumentFn({
                          data: { documentId: chapter.id },
                        })
                        await Promise.all([
                          queryClient.invalidateQueries({
                            queryKey: ['books'],
                          }),
                          queryClient.invalidateQueries({
                            queryKey: ['book-documents', book.slug],
                          }),
                        ])
                      }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </main>
  )
}

function BookAction({
  to,
  slug,
  children,
  className,
}: {
  to:
    | '/library/$bookSlug'
    | '/library/$bookSlug/pipeline'
    | '/library/$bookSlug/text'
    | '/library/$bookSlug/review'
    | '/library/$bookSlug/cast'
    | '/library/$bookSlug/voice-map'
    | '/library/$bookSlug/synthesis'
  slug: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      to={to}
      params={{ bookSlug: slug }}
      className={cn(
        'rounded-full border border-orange-900 px-4 py-2 w-fit font-serif text-xl transition-colors duration-150 ease-in-out hover:border-orange-950 hover:bg-orange-950 hover:text-orange-500',
        className,
      )}
    >
      {children}
    </Link>
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
