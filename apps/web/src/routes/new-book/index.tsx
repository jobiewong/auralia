import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import * as React from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Book } from '~/components/icons/book'
import { ExternalLink } from '~/components/icons/external-link'

import { Button } from '~/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { ProgressArc } from '~/components/ui/progress-arc'
import { getDocumentRouteTarget } from '~/db/documents'
import { createWork } from '~/db/works'
import { formatElapsed, useElapsedSeconds } from '~/hooks/use-elapsed-seconds'
import { getAo3WorkDraft, parseAo3Url } from '~/lib/ao3'
import type { Ao3UrlFormValues } from '~/lib/forms'
import { ao3UrlFormSchema } from '~/lib/forms'
import { ingestAo3Chapter, runSegmentation } from '~/lib/pipeline-api'

export const Route = createFileRoute('/new-book/')({
  ssr: false,
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const getRouteTarget = useServerFn(getDocumentRouteTarget)
  const createWorkFn = useServerFn(createWork)
  const [startedAt, setStartedAt] = React.useState<number | null>(null)
  const form = useForm<Ao3UrlFormValues>({
    resolver: zodResolver(ao3UrlFormSchema),
    defaultValues: {
      url: '',
    },
  })
  const elapsed = useElapsedSeconds(startedAt)
  const isRunning = startedAt !== null
  const parsedUrl = parseAo3Url(form.watch('url'))

  async function handleSubmit(values: Ao3UrlFormValues) {
    const trimmedUrl = values.url.trim()
    const parsedTrimmedUrl = parseAo3Url(trimmedUrl)
    setStartedAt(Date.now())

    try {
      const workDraft = getAo3WorkDraft(trimmedUrl)

      if (workDraft) {
        const work = await createWorkFn({ data: workDraft })

        await queryClient.invalidateQueries({ queryKey: ['books'] })
        setStartedAt(null)
        await navigate({
          to: '/library/$bookSlug',
          params: { bookSlug: work.slug },
        })
        return
      }

      if (!parsedTrimmedUrl || parsedTrimmedUrl.kind !== 'chapter') {
        form.setError('url', {
          type: 'validate',
          message:
            'Paste an AO3 chapter, work, or series URL from archiveofourown.org.',
        })
        setStartedAt(null)
        return
      }

      const result = await ingestAo3Chapter(parsedTrimmedUrl.url)
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

      setStartedAt(null)
      await navigate({
        to: '/library/$bookSlug/$documentId',
        params: routeTarget,
      })
    } catch (err) {
      setStartedAt(null)
      form.setError('url', {
        type: 'server',
        message: err instanceof Error ? err.message : 'Import failed',
      })
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
          Paste an AO3 chapter, work, or series URL. Chapter links import the
          first chapter and open it. Work and series links create an empty book
          and open that instead.
        </p>
      </section>

      <section className="px-6 pb-12 sm:px-10">
        <form
          noValidate
          onSubmit={form.handleSubmit(handleSubmit)}
          className="grid max-w-4xl gap-6 border-t py-8 font-serif"
        >
          <FieldGroup>
            <Controller
              name="url"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="new-book-url">AO3 URL</FieldLabel>
                  <Input
                    {...field}
                    id="new-book-url"
                    disabled={isRunning}
                    inputMode="url"
                    placeholder="https://archiveofourown.org/works/123"
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                    className="h-auto border-orange-950/35 bg-transparent px-4 py-3 text-base focus-visible:border-orange-950 focus-visible:ring-orange-950/20 sm:text-lg"
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />
          </FieldGroup>

          <div className="flex flex-wrap items-center gap-4">
            <Button
              type="submit"
              size="lg"
              disabled={isRunning}
              className="min-w-56"
            >
              <Book className="size-5" />
              {isRunning
                ? 'Working'
                : parsedUrl?.kind === 'chapter'
                  ? 'Import Chapter'
                  : 'Create Book'}
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
