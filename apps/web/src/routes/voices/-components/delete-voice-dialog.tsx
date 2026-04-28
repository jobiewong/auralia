import { useState } from 'react'
import { BracketButton } from '~/components/bracket-button'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
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
import { Field, FieldLabel } from '~/components/ui/field'
import type { Voice } from '~/db-collections'

export function DeleteVoiceDialog({
  voice,
  onDelete,
  onForceDelete,
}: {
  voice: Voice
  onDelete: () => void
  onForceDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [forceDelete, setForceDelete] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <BracketButton
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
        >
          Delete
        </BracketButton>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Voice</DialogTitle>
          <DialogDescription className="">
            Delete {voice.displayName}? This is blocked if mappings exist unless
            force delete is used.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-6">
          <Field orientation="horizontal">
            <Checkbox
              id="force-delete"
              onCheckedChange={(e) =>
                setForceDelete(e === 'indeterminate' ? false : e)
              }
            />
            <FieldLabel htmlFor="force-delete">Force delete</FieldLabel>
          </Field>
        </div>
        <DialogFooter className="mt-4">
          <Button
            variant="confirm"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              if (forceDelete) {
                onForceDelete()
              } else {
                onDelete()
              }
            }}
            size="lg"
          >
            Delete
          </Button>
          <DialogClose asChild>
            <Button
              variant="cancel"
              size="lg"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
              }}
            >
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
