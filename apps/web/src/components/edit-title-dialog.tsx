import { zodResolver } from '@hookform/resolvers/zod'
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
import type { TitleFormValues } from '~/lib/forms'
import { titleFormSchema } from '~/lib/forms'

export function EditTitleDialog({
  dialogTitle,
  description,
  fieldLabel,
  triggerLabel,
  submitLabel,
  defaultTitle,
  className,
  onSubmit,
}: {
  dialogTitle: string
  description: string
  fieldLabel: string
  triggerLabel: string
  submitLabel: string
  defaultTitle: string
  className?: string
  onSubmit: (values: TitleFormValues) => Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const form = useForm<TitleFormValues>({
    resolver: zodResolver(titleFormSchema),
    defaultValues: {
      title: defaultTitle,
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({ title: defaultTitle })
    }
  }, [defaultTitle, form, open])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          form.reset({ title: defaultTitle })
          setIsSubmitting(false)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="link" className={className}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          className="mt-6"
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            setIsSubmitting(true)
            try {
              await onSubmit(values)
              setOpen(false)
            } finally {
              setIsSubmitting(false)
            }
          })}
        >
          <FieldGroup>
            <Controller
              name="title"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="edit-title-dialog-input">
                    {fieldLabel}
                  </FieldLabel>
                  <Input
                    {...field}
                    id="edit-title-dialog-input"
                    variant="dialog"
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                    disabled={isSubmitting}
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
              disabled={isSubmitting}
              className="mt-8"
            >
              {isSubmitting ? 'Saving' : submitLabel}
            </Button>
            <DialogClose asChild>
              <Button
                type="button"
                variant="cancel"
                disabled={isSubmitting}
                size="lg"
                className="mt-8"
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
