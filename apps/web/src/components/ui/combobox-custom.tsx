import { Popover } from 'radix-ui'
import * as React from 'react'

import { cn } from '~/lib/utils'

export type ComboboxOption = {
  value: string
  label: string
}

function Combobox({
  value,
  options,
  placeholder = 'Select',
  searchPlaceholder = 'Search',
  allowCustom = false,
  className,
  onValueChange,
}: {
  value: string
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  allowCustom?: boolean
  className?: string
  onValueChange: (value: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const selectedOption = options.find((option) => option.value === value)
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        `${option.label} ${option.value}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : options
  const customValue = query.trim()
  const canUseCustom =
    allowCustom &&
    customValue.length > 0 &&
    !options.some(
      (option) => option.value.toLowerCase() === customValue.toLowerCase(),
    )

  function selectValue(nextValue: string) {
    onValueChange(nextValue)
    setQuery('')
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'font-serif text-left transition-colors hover:bg-orange-950/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-950 cursor-pointer leading-[1em] hover:text-orange-950',
            className,
          )}
        >
          [{(selectedOption?.label ?? value) || placeholder} +]
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-72 border border-orange-950 bg-orange-500 font-serif text-orange-950 shadow-none"
        >
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canUseCustom) {
                event.preventDefault()
                selectValue(customValue)
              }
            }}
            placeholder={searchPlaceholder}
            className="w-full border-b border-orange-950 bg-transparent px-2 py-1 font-serif text-orange-950 placeholder:text-orange-950/50 focus-visible:outline-none"
          />
          <div className="max-h-64 overflow-y-auto">
            {filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => selectValue(option.value)}
                className={cn(
                  'block w-full px-2 py-1 text-left transition-colors hover:bg-orange-950/10',
                  option.value === value && 'bg-orange-950/10',
                )}
              >
                {option.label}
              </button>
            ))}
            {canUseCustom && (
              <button
                type="button"
                onClick={() => selectValue(customValue)}
                className="block w-full px-2 py-1 text-left transition-colors hover:bg-orange-950/10"
              >
                Use {customValue}
              </button>
            )}
            {filteredOptions.length === 0 && !canUseCustom && (
              <p className="px-2 py-1 text-orange-950/50">No speaker found.</p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { Combobox }
