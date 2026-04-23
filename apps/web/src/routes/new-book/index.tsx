import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Book } from '~/components/icons/book'
import { ExternalLink } from '~/components/icons/external-link'

import { Button } from '~/components/ui/button'
import { ProgressArc } from '~/components/ui/progress-arc'
import { getDocumentRouteTarget } from '~/db/documents'
import { formatElapsed, useElapsedSeconds } from '~/hooks/use-elapsed-seconds'
import { ingestAo3Chapter, runSegmentation } from '~/lib/pipeline-api'

export const Route = createFileRoute('/new-book/')({
  ssr: false,
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const getRouteTarget = useServerFn(getDocumentRouteTarget)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const elapsed = useElapsedSeconds(startedAt)
  const isRunning = startedAt !== null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedUrl = url.trim()

    if (!trimmedUrl) {
      setError('Paste an AO3 chapter URL first.')
      return
    }

    setError(null)
    setStartedAt(Date.now())

    try {
      const result = await ingestAo3Chapter(trimmedUrl)
      const routeTarget = await getRouteTarget({
        data: { documentId: result.cleaned_document.id },
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({
          queryKey: ['book-documents', routeTarget.bookSlug],
        }),
        runSegmentation(result.cleaned_document.id),
      ])
      await navigate({
        to: '/library/$bookSlug/$documentId',
        params: routeTarget,
      })
    } catch (err) {
      setStartedAt(null)
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <main className="page-wrap">
      <section className="px-6 py-10 sm:px-10 sm:py-14">
        <p className="mb-4 font-serif text-xl text-foreground/50">
          <Link to="/library" className="hover:underline">
            Library
          </Link>{' '}
          / New Book
        </p>
        <h1 className="display-title mb-8">New Book</h1>
        <p className="max-w-2xl font-serif text-lg text-foreground/70">
          Paste one AO3 chapter URL. Auralia will import it as a single-document
          work, then open the document status page.
        </p>
      </section>

      <section className="px-6 pb-12 sm:px-10">
        <form
          onSubmit={handleSubmit}
          className="grid max-w-4xl gap-6 border-t py-8 font-serif"
        >
          <label className="grid gap-3">
            <span className="text-xl">AO3 chapter URL</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={isRunning}
              inputMode="url"
              placeholder="https://archiveofourown.org/works/123/chapters/456"
              className="w-full border border-orange-950/35 bg-transparent px-4 py-3 text-base outline-none transition focus:border-orange-950 focus:ring-2 focus:ring-orange-950/20 disabled:opacity-60 sm:text-lg"
            />
          </label>

          {error ? (
            <p className="text-base text-orange-950" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-4">
            <Button
              type="submit"
              size="lg"
              disabled={isRunning}
              className="min-w-56"
            >
              <Book className="size-5" />
              {isRunning ? 'Importing' : 'Begin Pipeline'}
            </Button>
            {isRunning ? (
              <p className="flex items-center gap-2 text-lg text-foreground/60">
                <ProgressArc className="size-5" />
                {formatElapsed(elapsed)}
              </p>
            ) : null}
            <a
              href="https://archiveofourown.org/"
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-2 text-base text-foreground/60 hover:underline"
            >
              AO3
              <ExternalLink className="size-4" />
            </a>
          </div>
        </form>
      </section>
    </main>
  )
}
