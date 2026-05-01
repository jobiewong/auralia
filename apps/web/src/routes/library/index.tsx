import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'

import { DeleteConfirmationDialog } from '~/components/delete-confirmation-dialog'
import { preloadBooks, useBooks } from '~/db-collections'
import { deleteWork } from '~/server/works'
import { formatDate } from '~/lib/utils'

export const Route = createFileRoute('/library/')({
  ssr: false,
  beforeLoad: ({ context }) => preloadBooks(context.queryClient),
  component: RouteComponent,
})

function RouteComponent() {
  const queryClient = useQueryClient()
  const deleteWorkFn = useServerFn(deleteWork)
  const books = useBooks()

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="rise-in relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14">
        <h1 className="display-title mb-8">Library</h1>
      </section>
      <section className="px-6 pb-8 sm:px-10">
        <nav className="flex flex-wrap gap-4">
          <Link to="/new-book" className="nav-link">
            New Book
          </Link>
        </nav>
      </section>
      <section className="px-6 py-8 sm:px-10">
        {books.length === 0 ? (
          <p className="font-serif text-2xl text-foreground/60">
            No books yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {books.map((book) => (
              <li
                key={book.id}
                className="flex items-center justify-between font-serif"
              >
                <Link
                  to="/library/$bookSlug"
                  params={{ bookSlug: book.slug }}
                  className="hover:underline"
                >
                  <p className="leading-tight">{book.title}</p>
                </Link>
                <div className="flex items-center gap-4">
                  <p className="text-sm tracking-normal text-foreground/50 sm:text-base">
                    {book.sourceType} / updated {formatDate(book.updatedAt)}
                  </p>
                  <DeleteConfirmationDialog
                    title="Delete work"
                    description={`Delete ${book.title} and all associated chapters, spans, jobs, and mappings? This cannot be undone.`}
                    triggerLabel="Delete"
                    confirmLabel="Delete Work"
                    onConfirm={async () => {
                      await deleteWorkFn({ data: { workId: book.id } })
                      await queryClient.invalidateQueries({
                        queryKey: ['books'],
                      })
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
