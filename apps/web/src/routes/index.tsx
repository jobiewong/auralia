import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: App })

const EXAMPLE_BOOKS = [
  { title: "Lily's Boy" },
  { title: 'Rag & Bone' },
  { title: 'Draco Malfoy and the Mortifying Ordeal of Being in Love' },
  { title: 'All the Young Dudes' },
  { title: 'Evitative' },
  { title: 'More books' },
]

function App() {
  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="rise-in relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14">
        <h1 className="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-black tracking-tight sm:text-6xl lg:text-8xl">
          Auralia
        </h1>
        <p className="mb-8 max-w-xl text-base sm:text-lg">
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
        <ul>
          {EXAMPLE_BOOKS.slice(0, 5).map((book) => (
            <BookItem key={book.title} title={book.title} slug={book.title} />
          ))}
          {EXAMPLE_BOOKS.length > 5 && (
            <li>
              <Link to="/library" className="font-bold hover:underline">
                +{EXAMPLE_BOOKS.length - 5} more
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
  to: string
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className="rounded-full text-xl border border-orange-900 px-4 py-2 w-fit hover:bg-orange-950 hover:text-orange-500 transition-colors duration-150 ease-in-out hover:border-orange-950"
      px-4
      py-2
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
        className="hover:underline"
      >
        {title}
      </Link>
    </li>
  )
}
