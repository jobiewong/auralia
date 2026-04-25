import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '~/lib/utils'

const inputVariants = cva(
  'w-full min-w-0 rounded-none shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'h-9 border bg-transparent px-3 py-1 text-base md:text-sm focus-visible:bg-orange-900/10 placeholder:text-orange-950/40',
        dialog:
          'h-9 border border-orange-500 px-4 py-3 text-base sm:text-lg focus-visible:bg-orange-900/20 focus-visible:ring-orange-950/20 placeholder:text-orange-500/30',
        underline:
          'h-auto border-0 border-b border-orange-500 bg-transparent px-1 text-base md:text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Input({
  className,
  type,
  variant,
  ...props
}: React.ComponentProps<'input'> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Input, inputVariants }
