import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { JobTimer } from '~/components/job-timer'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '~/components/ui/tooltip'

import { cn } from '~/lib/utils'
import { JobSummary } from './job-summary'

export function PipelineStage({
  label,
  status,
  detail,
  diagnostics,
  timerJob,
  action,
}: {
  label: string
  status: string
  detail: ReactNode
  diagnostics?: {
    id: string
    status: string
    modelName?: string | null
    stats?: string | null
    errorReport?: string | null
    completedAt?: string | null
    createdAt: string
    updatedAt: string
  } | null
  timerJob?: {
    status: string
    createdAt: string
  } | null
  action?: ReactNode
}) {
  return (
    <li className="grid grid-cols-[4rem_1fr]">
      <div className="relative flex justify-center">
        <div className="h-full w-px bg-foreground" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background grid place-content-center p-0.5 border-foreground">
          <motion.div
            animate={{
              scale: status === 'completed' ? 1 : 0,
            }}
            className="size-3 bg-foreground rounded-full"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 mb-8">
        <div>
          <Tooltip>
            <p>{label}</p>
            <TooltipTrigger asChild>
              <p
                className={cn(
                  'cursor-help w-fit',
                  !diagnostics && 'cursor-default',
                )}
              >
                <span className="uppercase opacity-70">{status}</span>
                <span className="text-foreground/40 ml-2">-- {detail}</span>
              </p>
            </TooltipTrigger>
            {diagnostics ? (
              <TooltipContent>
                <JobSummary title={label} job={diagnostics} />
              </TooltipContent>
            ) : null}
          </Tooltip>
        </div>
        <div className="flex items-center gap-4">
          {action ?? null}
          {timerJob ? <JobTimer job={timerJob} /> : null}
        </div>
      </div>
    </li>
  )
}
