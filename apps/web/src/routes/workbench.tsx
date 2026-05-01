import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Button } from '~/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'
import { Select } from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
import { preloadVoices, useVoices } from '~/db-collections'
import { generateVoiceAudio } from '~/lib/voices-api'

export const Route = createFileRoute('/workbench')({
  ssr: false,
  beforeLoad: ({ context }) => preloadVoices(context.queryClient),
  component: WorkbenchRoute,
})

function WorkbenchRoute() {
  const voices = useVoices()
  const [selectedVoiceId, setSelectedVoiceId] = useState('')
  const [text, setText] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  const selectedVoice = selectedVoiceId || voices[0]?.id || ''
  const voiceOptions = useMemo(
    () =>
      voices.map((voice) => ({
        value: voice.id,
        label: voice.displayName,
      })),
    [voices],
  )

  async function handleGenerate() {
    setError(null)
    setAudioUrl(null)
    if (!selectedVoice) {
      setError('Select a voice first.')
      return
    }
    if (!text.trim()) {
      setError('Enter text to generate.')
      return
    }
    setIsGenerating(true)
    try {
      const result = await generateVoiceAudio(selectedVoice, text)
      setAudioUrl(result.audio_url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audio generation failed')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <main className="page-wrap">
      <section className="px-6 py-10 sm:px-10 sm:py-14">
        <div className="mb-8">
          <h1 className="display-title">Workbench</h1>
        </div>

        <div className="max-w-3xl font-serif">
          <FieldGroup>
            <Field>
              <FieldLabel>Voice</FieldLabel>
              <Select
                value={selectedVoice}
                onValueChange={setSelectedVoiceId}
                options={voiceOptions}
                className="w-full border-orange-500"
                disabled={voices.length === 0 || isGenerating}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="workbench-text">Text</FieldLabel>
              <Textarea
                id="workbench-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="min-h-48"
                disabled={isGenerating}
              />
            </Field>

            {error && (
              <Field>
                <FieldError>{error}</FieldError>
              </Field>
            )}

            <div>
              <Button
                type="button"
                size="lg"
                variant="confirm"
                disabled={isGenerating || voices.length === 0}
                onClick={handleGenerate}
              >
                {isGenerating ? 'Generating...' : 'Generate Audio'}
              </Button>
            </div>

            {audioUrl && (
              <Field>
                <FieldLabel>Audio</FieldLabel>
                <audio key={audioUrl} controls src={audioUrl} />
              </Field>
            )}
          </FieldGroup>
        </div>
      </section>
    </main>
  )
}
