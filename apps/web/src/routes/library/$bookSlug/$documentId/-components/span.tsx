import type { ComboboxOption } from '~/components/ui/combobox-custom'
import type { DocumentSpan } from '~/db-collections'
import { cn, formatConfidence, formatTextLength } from '~/lib/utils'
import { SpanAttributionEditor } from './span-attribution-editor'

export function Span({
  span,
  index,
  context,
  speakerOptions,
  isActive,
  onActivate,
  onSave,
}: {
  span: DocumentSpan
  index: number
  context: boolean
  speakerOptions: ComboboxOption[]
  isActive: boolean
  onActivate: () => void
  onSave: (data: {
    spanId: string
    speaker: string
    needsReview: boolean
  }) => Promise<void>
}) {
  const showEditor =
    span.type === 'dialogue' &&
    (isActive || span.needsReview || span.speaker === 'UNKNOWN')

  return (
    <li
      id={`span-${span.id}`}
      className={cn(
        'grid gap-2 py-1.5 px-2 font-serif sm:grid-cols-[4rem_9rem_minmax(0,1fr)] sm:items-baseline hover:bg-orange-950/5',
        context && 'opacity-60',
        span.needsReview && 'bg-orange-950/10 hover:bg-orange-950/10',
      )}
      onClick={onActivate}
    >
      <p className="text-foreground/50">{String(index + 1).padStart(2, '0')}</p>
      <p className="text-foreground/50">{span.type}</p>
      <div>
        {span.speaker && (
          <p className="mb-1 text-foreground/50">
            {span.speaker} / {formatConfidence(span.speakerConfidence)}
            {span.needsReview ? ' / needs review' : ''}
          </p>
        )}
        <p className="leading-tight">{span.text}</p>
        <p className="text-foreground/50">
          {span.start}-{span.end} / {formatTextLength(span.end - span.start)}
        </p>
        {showEditor && (
          <SpanAttributionEditor
            span={span}
            speakerOptions={speakerOptions}
            onSave={onSave}
          />
        )}
      </div>
    </li>
  )
}
