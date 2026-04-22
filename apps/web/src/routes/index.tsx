import { createFileRoute, Link } from '@tanstack/react-router'

import { preloadBooks, useBooks } from '~/db-collections'
import { getHiddenBookCount, getHomeBooks } from '~/lib/books'

export const Route = createFileRoute('/')({
  ssr: false,
  beforeLoad: ({ context }) => preloadBooks(context.queryClient),
  component: App,
})

function App() {
  const books = useBooks()
  const visibleBooks = getHomeBooks(books)
  const hiddenCount = getHiddenBookCount(books.length, visibleBooks.length)

  return (
    <main className="page-wrap">
      <section className="rise-in relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14">
        <h1 className="display-title mb-8">Auralia</h1>
        <p className="mb-8 max-w-xl text-base sm:text-lg font-serif">
          Generate fully-voiced audiobooks from your own text or AO3
          publications using entirely local AI.
        </p>
      </section>
      <section className="gap-4 px-6 py-10 sm:px-10 sm:py-14 grid grid-cols-2">
        <nav className="flex flex-col gap-4">
          <LinkButton to="/new-book">New Book</LinkButton>
          <LinkButton to="/library">Library</LinkButton>
          <LinkButton to="/library">Voices</LinkButton>
          <LinkButton to="/library">Queue</LinkButton>
        </nav>
        <ul className="space-y-2">
          {visibleBooks.length === 0 && (
            <li className="font-serif text-foreground/60">No books yet.</li>
          )}
          {visibleBooks.map((book) => (
            <BookItem key={book.id} title={book.title} slug={book.slug} />
          ))}
          {hiddenCount > 0 && (
            <li>
              <Link to="/library" className="font-serif hover:underline">
                +{hiddenCount} more
              </Link>
            </li>
          )}
        </ul>
      </section>
    </main>
  )
}

function LinkButton({
  to,
  children,
}: {
  to: '/' | '/new-book' | '/library'
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className="rounded-full font-serif text-xl border border-orange-900 px-4 py-2 w-fit hover:bg-orange-950 hover:text-orange-500 transition-colors duration-150 ease-in-out hover:border-orange-950"
    >
      {children}
    </Link>
  )
}

function BookItem({ title, slug }: { title: string; slug: string }) {
  return (
    <li>
      <Link
        to="/library/$bookSlug"
        params={{ bookSlug: slug }}
        className="hover:underline font-serif"
      >
        {title}
      </Link>
    </li>
  )
}
