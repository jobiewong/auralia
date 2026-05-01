import { SandTimer } from '~/components/ui/sand-timer'
import {
  formatElapsed,
  useElapsedSecondsFromTimestamp,
} from '~/hooks/use-elapsed-seconds'

export function JobTimer({
  job,
}: {
  job: {
    status: string
    createdAt: string
  }
}) {
  const elapsed = useElapsedSecondsFromTimestamp(job.createdAt)

  return (
    <p className="flex items-center gap-2 font-serif text-lg text-foreground/60">
      <SandTimer className="size-5 animate-sand-timer" />
      {job.status} for {formatElapsed(elapsed)}
    </p>
  )
}
