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
            className="bg-orange-500 text-orange-950 disabled:opacity-50 hover:bg-orange-500/70 hover:text-orange-950"
          >
            {isDeleting ? 'Deleting' : confirmLabel}
          </Button>
          <DialogClose asChild>
            <Button
              disabled={isDeleting}
              size="lg"
              className="text-orange-500 border-orange-500 hover:bg-orange-500 hover:text-orange-950"
            >
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
