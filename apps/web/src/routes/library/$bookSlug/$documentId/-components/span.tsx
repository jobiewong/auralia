import type { ComboboxOption } from '~/components/ui/combobox-custom'
import { useState } from 'react'
import { BracketButton } from '~/components/bracket-button'
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
  onSaveText,
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
  onSaveText: (data: { spanId: string; text: string }) => Promise<void>
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
          source offsets {span.start}-{span.end} /{' '}
          {formatTextLength(span.text.length)}
        </p>
        {isActive && <SpanTextEditor span={span} onSaveText={onSaveText} />}
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

function SpanTextEditor({
  span,
  onSaveText,
}: {
  span: DocumentSpan
  onSaveText: (data: { spanId: string; text: string }) => Promise<void>
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftText, setDraftText] = useState(span.text)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEditing() {
    setDraftText(span.text)
    setError(null)
    setIsEditing(true)
  }

  function cancelEditing() {
    setDraftText(span.text)
    setError(null)
    setIsEditing(false)
  }

  async function saveText() {
    if (draftText.trim().length === 0) {
      setError('Span text cannot be blank.')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      await onSaveText({ spanId: span.id, text: draftText })
      setIsEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Span text update failed.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!isEditing) {
    return (
      <div className="mt-3" onClick={(event) => event.stopPropagation()}>
        <BracketButton onClick={startEditing}>Edit text</BracketButton>
      </div>
    )
  }

  return (
    <div
      className="mt-3 grid gap-2 text-foreground/70"
      onClick={(event) => event.stopPropagation()}
    >
      <textarea
        className="min-h-28 w-full resize-y border bg-background p-2 font-serif leading-tight text-foreground outline-none focus:border-foreground/60"
        value={draftText}
        onChange={(event) => setDraftText(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <BracketButton
          disabled={isSaving || draftText.trim().length === 0}
          onClick={saveText}
        >
          Save
        </BracketButton>
        <BracketButton disabled={isSaving} onClick={cancelEditing}>
          Cancel
        </BracketButton>
        {error ? (
          <p className="text-orange-950" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
