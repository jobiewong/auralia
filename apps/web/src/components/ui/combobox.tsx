'use client'

import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { XIcon } from 'lucide-react'
import * as React from 'react'

import { Button } from '~/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '~/components/ui/input-group'
import { cn } from '~/lib/utils'

const ComboboxRoot = ComboboxPrimitive.Root

export type ComboboxOption = {
  value: string
  label: string
}

type InternalComboboxOption = ComboboxOption & {
  custom?: boolean
}

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        'cursor-pointer font-serif leading-[1em] text-left transition-colors hover:bg-orange-950/10 hover:text-orange-950 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-950',
        className,
      )}
      {...props}
    >
      {children ?? '[+]'}
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      render={<InputGroupButton variant="ghost" size="icon-xs" />}
      className={cn(className)}
      {...props}
    >
      <XIcon className="pointer-events-none" />
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showTrigger?: boolean
  showClear?: boolean
}) {
  return (
    <InputGroup
      className={cn(
        'h-auto w-auto rounded-none border-0 border-b border-orange-950! bg-orange-500! shadow-none ring-0!',
        className,
      )}
    >
      <ComboboxPrimitive.Input
        render={
          <InputGroupInput
            disabled={disabled}
            className="px-2 py-1 font-serif text-orange-950 placeholder:text-orange-950/50 focus-visible:outline-none focus-visible:ring-0 focus-visible:border-0!"
          />
        }
        {...props}
      />
      <InputGroupAddon align="inline-end">
        {showTrigger && (
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            asChild
            data-slot="input-group-button"
            className="group-has-data-[slot=combobox-clear]/input-group:hidden data-pressed:bg-transparent"
            disabled={disabled}
          >
            <ComboboxTrigger />
          </InputGroupButton>
        )}
        {showClear && <ComboboxClear disabled={disabled} />}
      </InputGroupAddon>
      {children}
    </InputGroup>
  )
}

function ComboboxContent({
  className,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  alignOffset = 0,
  anchor,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor'
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-chips={!!anchor}
          className={cn(
            'group/combobox-content relative max-h-96 w-72 max-w-(--available-width) origin-(--transform-origin) overflow-hidden border border-orange-950 bg-orange-500 font-serif text-orange-950 shadow-none',
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        'max-h-64 scroll-py-1 overflow-y-auto data-empty:p-0',
        className,
      )}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 px-2 py-1 font-serif outline-hidden select-none transition-colors data-highlighted:bg-orange-950/10 data-[selected]:bg-orange-950/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      className={cn(className)}
      {...props}
    />
  )
}

function ComboboxLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn(
        'px-2 py-1.5 text-orange-950/50 pointer-coarse:px-3 pointer-coarse:py-2',
        className,
      )}
      {...props}
    />
  )
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return (
    <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        'hidden w-full px-2 py-1 text-orange-950/50 group-data-empty/combobox-content:block',
        className,
      )}
      {...props}
    />
  )
}

function ComboboxSeparator({
  className,
  ...props
}: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn('my-1 h-px bg-orange-950', className)}
      {...props}
    />
  )
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
  ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 border border-orange-950 bg-transparent px-2.5 py-1.5 font-serif transition-colors focus-within:ring-1 focus-within:ring-orange-950 has-data-[slot=combobox-chip]:px-1.5',
        className,
      )}
      {...props}
    />
  )
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        'flex h-[calc(--spacing(5.5))] w-fit items-center justify-center gap-1 bg-orange-950/10 px-1.5 font-serif text-xs whitespace-nowrap text-orange-950 has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50 has-data-[slot=combobox-chip-remove]:pr-0',
        className,
      )}
      {...props}
    >
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          render={<Button variant="ghost" size="icon-xs" />}
          className="-ml-1 opacity-50 hover:opacity-100"
          data-slot="combobox-chip-remove"
        >
          <XIcon className="pointer-events-none" />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  )
}

function ComboboxChipsInput({
  className,
  children,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn(
        'min-w-16 flex-1 bg-transparent font-serif outline-none',
        className,
      )}
      {...props}
    />
  )
}

function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null)
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
  const [inputValue, setInputValue] = React.useState('')
  const selectedOption = options.find((option) => option.value === value)
  const customValue = inputValue.trim()
  const canUseCustom =
    allowCustom &&
    customValue.length > 0 &&
    !options.some(
      (option) => option.value.toLowerCase() === customValue.toLowerCase(),
    )
  const items: InternalComboboxOption[] = React.useMemo(
    () =>
      canUseCustom
        ? [...options, { value: customValue, label: customValue, custom: true }]
        : options,
    [canUseCustom, customValue, options],
  )

  return (
    <ComboboxRoot
      items={items}
      value={selectedOption ?? null}
      inputValue={inputValue}
      itemToStringLabel={(item) => item?.label ?? ''}
      itemToStringValue={(item) => item?.value ?? ''}
      isItemEqualToValue={(item, selected) => item?.value === selected?.value}
      onInputValueChange={(nextInputValue) => setInputValue(nextInputValue)}
      onValueChange={(nextValue: InternalComboboxOption | null) => {
        if (!nextValue) {
          return
        }
        onValueChange(nextValue.value)
        setInputValue('')
      }}
    >
      <ComboboxTrigger className={className}>
        [{(selectedOption?.label ?? value) || placeholder} +]
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput placeholder={searchPlaceholder} showTrigger={false} />
        <ComboboxEmpty>No speaker found.</ComboboxEmpty>
        <ComboboxList>
          {(item: InternalComboboxOption) => (
            <ComboboxItem key={item.value} value={item}>
              {item.custom ? `Use ${item.label}` : item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </ComboboxRoot>
  )
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxRoot,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
}
