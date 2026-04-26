import * as React from 'react'

import { cn } from '~/lib/utils'

type LoadingEllipsisProps = {
  /** Text shown before the animated dots (no trailing dots). */
  children: React.ReactNode
  className?: string
  /** Total loop length in ms (default 1600). */
  durationMs?: number
}

/**
 * Inline loading hint: fixed-width “…” where each dot fades out in order,
 * then fades back in in order, without changing layout width.
 */
export function LoadingEllipsis({
  children,
  className,
  durationMs = 1600,
}: LoadingEllipsisProps) {
  return (
    <span
      className={cn('inline-flex max-w-full min-w-0 items-baseline', className)}
    >
      <span className="min-w-0 shrink">{children}</span>
      <span
        className="loading-ellipsis-dots inline-flex shrink-0 font-mono text-[1em] leading-none"
        style={
          {
            '--loading-ellipsis-duration': `${durationMs}ms`,
          } as React.CSSProperties
        }
        aria-hidden
      >
        <span className="loading-ellipsis-dot tracking-tight loading-ellipsis-dot--1">
          .
        </span>
        <span className="loading-ellipsis-dot tracking-tight loading-ellipsis-dot--2">
          .
        </span>
        <span className="loading-ellipsis-dot tracking-tight loading-ellipsis-dot--3">
          .
        </span>
      </span>
    </span>
  )
}
