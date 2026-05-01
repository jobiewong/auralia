import {
  diffSeconds,
  formatElapsed,
  useElapsedSecondsFromTimestamp,
} from '~/hooks/use-elapsed-seconds'
import { formatDate, formatJsonSummary } from '~/lib/utils'

function isActiveJobStatus(status: string) {
  return status === 'pending' || status === 'running'
}

export function JobSummary({
  title,
  job,
}: {
  title: string
  job: {
    id: string
    status: string
    modelName?: string | null
    stats?: string | null
    errorReport?: string | null
    completedAt?: string | null
    createdAt: string
    updatedAt: string
  } | null
}) {
  const activeElapsed = useElapsedSecondsFromTimestamp(
    job && isActiveJobStatus(job.status) ? job.createdAt : null,
  )
  const duration =
    job && isActiveJobStatus(job.status)
      ? formatElapsed(activeElapsed)
      : job?.completedAt && job.createdAt
        ? formatElapsed(diffSeconds(job.createdAt, job.completedAt))
        : null

  return (
    <div className="font-serif">
      <h2 className="mb-2 border-b pb-2 border-orange-500 -mx-3 px-3 text-3xl">
        {title}
      </h2>
      {!job ? (
        <p className="text-orange-500/50">No job recorded.</p>
      ) : (
        <dl className="grid gap-2 border-t py-5 sm:grid-cols-[9rem_1fr]">
          <dt className="text-orange-500/50">Status</dt>
          <dd>{job.status}</dd>
          <dt className="text-orange-500/50">Started</dt>
          <dd>{formatDate(job.createdAt, true)}</dd>
          <dt className="text-orange-500/50">Completed</dt>
          <dd>
            {job.completedAt
              ? formatDate(job.completedAt, true)
              : 'not complete'}
          </dd>
          <dt className="text-orange-500/50">Duration</dt>
          <dd>
            {duration ??
              (job.status === 'failed' ? 'not recorded' : 'not complete')}
          </dd>
          <dt className="text-orange-500/50">Updated</dt>
          <dd>{formatDate(job.updatedAt, true)}</dd>
          <dt className="text-orange-500/50">Model</dt>
          <dd>{job.modelName || 'none'}</dd>
          <dt className="text-orange-500/50">Stats</dt>
          <dd>{formatJsonSummary(job.stats)}</dd>
          <dt className="text-orange-500/50">Error</dt>
          <dd>{formatJsonSummary(job.errorReport)}</dd>
        </dl>
      )}
    </div>
  )
}
