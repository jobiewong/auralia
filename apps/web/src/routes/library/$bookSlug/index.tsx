import { createFileRoute, Link } from '@tanstack/react-router'

import { preloadBooks, useBooks } from '~/db-collections'

export const Route = createFileRoute('/library/$bookSlug/')({
  ssr: false,
  beforeLoad: ({ context }) => preloadBooks(context.queryClient),
  component: RouteComponent,
})

function RouteComponent() {
  const { bookSlug } = Route.useParams()
  const books = useBooks()
  const book = books.find((item) => item.slug === bookSlug)

  if (!book) {
    return (
      <main className="page-wrap px-4 pb-8 pt-14">
        <section className="px-6 py-10 sm:px-10 sm:py-14">
          <p className="mb-4 font-serif text-xl">Library</p>
          <h1 className="mb-8 text-4xl leading-tight font-black sm:text-6xl font-decorative">
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
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="rise-in px-6 py-10 sm:px-10 sm:py-14">
        <p className="mb-4 font-serif text-xl">
          {book.sourceType} / updated {formatDate(book.updatedAt)}
        </p>
        <h1 className="display-title mb-8 max-w-5xl text-4xl leading-[1.02] font-black tracking-tight sm:text-6xl lg:text-8xl font-decorative">
          {book.title}
        </h1>
        <dl className="grid max-w-4xl gap-3 border-y border-orange-900/35 py-5 font-serif text-lg sm:grid-cols-[12rem_1fr] sm:text-xl">
          <dt className="text-foreground/60">Source</dt>
          <dd>{book.sourceId}</dd>
          <dt className="text-foreground/60">Slug</dt>
          <dd>{book.slug}</dd>
          <dt className="text-foreground/60">Created</dt>
          <dd>{formatDate(book.createdAt)}</dd>
        </dl>
      </section>

      <section className="px-6 py-8 sm:px-10">
        <nav className="flex flex-wrap gap-4">
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
        </nav>
      </section>
    </main>
  )
}

function BookAction({
  to,
  slug,
  children,
}: {
  to:
    | '/library/$bookSlug/pipeline'
    | '/library/$bookSlug/text'
    | '/library/$bookSlug/review'
    | '/library/$bookSlug/cast'
    | '/library/$bookSlug/voice-map'
    | '/library/$bookSlug/synthesis'
  slug: string
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      params={{ bookSlug: slug }}
      className="rounded-full border border-orange-900 px-4 py-2 font-serif text-xl transition-colors duration-150 ease-in-out hover:border-orange-950 hover:bg-orange-950 hover:text-orange-500"
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
