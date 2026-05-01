import * as React from 'react'
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

export function DeleteConfirmationDialog({
  title,
  description,
  triggerLabel,
  confirmLabel,
  onConfirm,
  className,
}: {
  title: string
  description: string
  triggerLabel: string
  confirmLabel: string
  onConfirm: () => Promise<void>
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="link" className={className}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="confirm"
            disabled={isDeleting}
            onClick={async () => {
              setIsDeleting(true)
              try {
                await onConfirm()
                setOpen(false)
              } finally {
                setIsDeleting(false)
              }
            }}
            size="lg"
          >
            {isDeleting ? 'Deleting' : confirmLabel}
          </Button>
          <DialogClose asChild>
            <Button
              variant="cancel"
              disabled={isDeleting}
              size="lg"
            >
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
