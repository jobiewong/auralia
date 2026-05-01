import type { FormEvent } from 'react'
import { useState } from 'react'
import { BracketButton } from '~/components/bracket-button'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'

export type CastFormState = {
  canonicalName: string
  aliases: string
  descriptor: string
}

export const emptyCastForm: CastFormState = {
  canonicalName: '',
  aliases: '',
  descriptor: '',
}

export function CastFormDialog({
  mode,
  initialForm,
  onSave,
}: {
  mode: 'Add' | 'Edit'
  initialForm: CastFormState
  onSave: (form: CastFormState) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [isSaving, setIsSaving] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setForm(initialForm)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    try {
      await onSave(form)
      setOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <BracketButton>{mode}</BracketButton>
      </DialogTrigger>
      <DialogContent className="w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode} Cast</DialogTitle>
        </DialogHeader>
        <form className="mt-8 grid gap-5 font-serif" onSubmit={handleSubmit}>
          <label className="grid gap-2">
            <span className="text-orange-500/60">Name</span>
            <Input
              value={form.canonicalName}
              onChange={(event) =>
                setForm({ ...form, canonicalName: event.target.value })
              }
              variant="underline"
              className="text-orange-500"
              required
            />
          </label>

          <label className="grid gap-2">
            <span className="text-orange-500/60">Aliases</span>
            <Input
              value={form.aliases}
              onChange={(event) =>
                setForm({ ...form, aliases: event.target.value })
              }
              variant="underline"
              className="text-orange-500 placeholder:text-orange-500/40"
              placeholder="comma separated"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-orange-500/60">Descriptor</span>
            <Input
              value={form.descriptor}
              onChange={(event) =>
                setForm({ ...form, descriptor: event.target.value })
              }
              variant="underline"
              className="text-orange-500"
            />
          </label>

          <DialogFooter>
            <Button
              type="submit"
              variant="confirm"
              disabled={isSaving}
              size="lg"
            >
              {isSaving ? 'Saving' : mode === 'Edit' ? 'Save' : 'Add'}
            </Button>
            <DialogClose asChild>
              <Button variant="cancel" disabled={isSaving} size="lg">
                Cancel
              </Button>
            </DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
