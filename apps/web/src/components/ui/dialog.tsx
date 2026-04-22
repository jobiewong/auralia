import * as React from 'react'

import { cn } from '~/lib/utils'

type DialogContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogContext() {
  const context = React.useContext(DialogContext)
  if (!context) {
    throw new Error('Dialog components must be used inside Dialog')
  }
  return context
}

export function Dialog({
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = controlledOpen ?? uncontrolledOpen

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [onOpenChange],
  )

  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      {children}
    </DialogContext.Provider>
  )
}

export function DialogTrigger({
  children,
  asChild,
}: {
  children: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>
  asChild?: boolean
}) {
  const { setOpen } = useDialogContext()
  const child = React.Children.only(children)
  const onClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    child.props.onClick?.(event)
    if (!event.defaultPrevented) {
      setOpen(true)
    }
  }

  if (asChild) {
    return React.cloneElement(child, { onClick })
  }

  return (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  )
}

export function DialogContent({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const { open, setOpen } = useDialogContext()
  const dialogRef = React.useRef<HTMLDialogElement>(null)

  React.useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }

    if (open && !dialog.open && typeof dialog.showModal === 'function') {
      dialog.showModal()
    }
    if (open && !dialog.open) {
      dialog.setAttribute('open', '')
    }
    if (!open && dialog.open && typeof dialog.close === 'function') {
      dialog.close()
    }
    if (!open && dialog.open) {
      dialog.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault()
        setOpen(false)
      }}
      onClose={() => setOpen(false)}
      className={cn(
        'm-auto max-w-xl bg-orange-950 text-orange-500 p-0 backdrop:bg-orange-950/0',
        className,
      )}
    >
      <div className="px-6 py-6 sm:px-8 sm:py-7">{children}</div>
    </dialog>
  )
}

export function DialogHeader({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={cn('space-y-2', className)}>{children}</div>
}

export function DialogFooter({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('mt-8 flex flex-wrap gap-3', className)}>{children}</div>
  )
}

export function DialogTitle({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <h2 className={cn('font-display text-4xl leading-tight', className)}>
      {children}
    </h2>
  )
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <p className={cn('font-serif text-lg text-orange-500/60', className)}>
      {children}
    </p>
  )
}

export function DialogClose({
  children,
  asChild,
}: {
  children: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>
  asChild?: boolean
}) {
  const { setOpen } = useDialogContext()
  const child = React.Children.only(children)
  const onClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    child.props.onClick?.(event)
    if (!event.defaultPrevented) {
      setOpen(false)
    }
  }

  if (asChild) {
    return React.cloneElement(child, { onClick })
  }

  return (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  )
}
