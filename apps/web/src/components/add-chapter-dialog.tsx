import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import * as React from 'react'
import { Controller, useForm } from 'react-hook-form'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { getDocumentRouteTarget } from '~/server/documents'
import { parseAo3Url } from '~/lib/ao3'
import type { Ao3UrlFormValues } from '~/lib/forms'
import { ao3UrlFormSchema } from '~/lib/forms'
import { ingestAo3Chapter, runSegmentation } from '~/server/pipeline-api'

export function AddChapterDialog({
  bookSlug,
  workSourceId,
  className,
}: {
  bookSlug: string
  workSourceId: string
  className?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const getRouteTarget = useServerFn(getDocumentRouteTarget)
  const [open, setOpen] = React.useState(false)
  const [isImporting, setIsImporting] = React.useState(false)
  const form = useForm<Ao3UrlFormValues>({
    resolver: zodResolver(ao3UrlFormSchema),
    defaultValues: {
      url: '',
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          form.reset({ url: '' })
          setIsImporting(false)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="lg" className={className}>
          Add Chapter
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Chapter</DialogTitle>
          <DialogDescription>
            Paste an AO3 chapter URL to import it into this work.
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-6 grid gap-4"
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            const parsed = parseAo3Url(values.url)

            if (!parsed || parsed.kind !== 'chapter') {
              form.setError('url', {
                type: 'validate',
                message: 'Paste an AO3 chapter URL first.',
              })
              return
            }

            setIsImporting(true)

            try {
              const result = await ingestAo3Chapter(parsed.url, {
                sourceId: workSourceId,
              })
              const routeTarget = await getRouteTarget({
                data: { documentId: result.cleaned_document.id },
              })

              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['books'] }),
                queryClient.invalidateQueries({
                  queryKey: ['book-documents', bookSlug],
                }),
                runSegmentation(result.cleaned_document.id),
              ])

              setOpen(false)
              await navigate({
                to: '/library/$bookSlug/$documentId',
                params: routeTarget,
              })
            } catch (err) {
              form.setError('url', {
                type: 'server',
                message: err instanceof Error ? err.message : 'Import failed',
              })
              setIsImporting(false)
            }
          })}
        >
          <FieldGroup>
            <Controller
              name="url"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="add-chapter-url">
                    AO3 chapter URL
                  </FieldLabel>
                  <Input
                    {...field}
                    id="add-chapter-url"
                    variant="dialog"
                    disabled={isImporting}
                    inputMode="url"
                    placeholder="https://archiveofourown.org/works/123/chapters/456"
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />
          </FieldGroup>

          <DialogFooter>
            <Button
              type="submit"
              variant="confirm"
              size="lg"
              disabled={isImporting}
            >
              {isImporting ? 'Importing' : 'Import Chapter'}
            </Button>
            <DialogClose asChild>
              <Button
                type="button"
                variant="cancel"
                disabled={isImporting}
                size="lg"
              >
                Cancel
              </Button>
            </DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
