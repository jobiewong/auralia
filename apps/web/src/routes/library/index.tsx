import { createFileRoute, Link } from '@tanstack/react-router'

import { preloadBooks, useBooks } from '~/db-collections'

export const Route = createFileRoute('/library/')({
  ssr: false,
  beforeLoad: ({ context }) => preloadBooks(context.queryClient),
  component: RouteComponent,
})

function RouteComponent() {
  const books = useBooks()

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="rise-in relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14">
        <p className="mb-4 font-serif text-xl">Library</p>
        <h1 className="display-title mb-5 max-w-4xl text-4xl leading-[1.02] font-black tracking-tight sm:text-6xl lg:text-8xl font-decorative">
          All Books
        </h1>
      </section>
      <section className="px-6 py-8 sm:px-10">
        {books.length === 0 ? (
          <p className="font-serif text-2xl text-foreground/60">
            No books yet.
          </p>
        ) : (
          <ul className="divide-y divide-orange-900/35 border-y border-orange-900/35">
            {books.map((book) => (
              <li key={book.id}>
                <Link
                  to="/library/$bookSlug"
                  params={{ bookSlug: book.slug }}
                  className="grid gap-2 py-5 font-serif hover:underline sm:grid-cols-[1fr_auto] sm:items-end"
                >
                  <span className="text-2xl leading-tight sm:text-4xl">
                    {book.title}
                  </span>
                  <span className="text-sm uppercase tracking-normal text-foreground/60 sm:text-base">
                    {book.sourceType} / updated {formatDate(book.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
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
