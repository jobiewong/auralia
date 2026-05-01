import {
  deleteJson,
  getJson,
  patchForm,
  postForm,
  postJson,
} from '~/lib/http'
import type { VoiceFormValues, VoiceMode } from '~/lib/voices.types'

export type { VoiceMode, VoiceFormValues } from '~/lib/voices.types'

export type Voice = {
  id: string
  displayName: string
  mode: VoiceMode
  controlText: string | null
  referenceAudioPath: string | null
  promptAudioPath: string | null
  promptText: string | null
  temperature: number
  isCanonical: boolean
  previewAudioPath: string | null
  previewSentence: string | null
  createdAt: string
  updatedAt: string
}

export type VoiceMapping = {
  id: string
  documentId: string
  speaker: string
  voiceId: string
  voiceName: string | null
  createdAt: string
  updatedAt: string
}

type ApiVoice = {
  id: string
  display_name: string
  mode: VoiceMode
  control_text: string | null
  reference_audio_path: string | null
  prompt_audio_path: string | null
  prompt_text: string | null
  temperature: number
  is_canonical: boolean
  preview_audio_path: string | null
  preview_sentence: string | null
  created_at: string
  updated_at: string
}

type ApiVoiceMapping = {
  id: string
  document_id: string
  speaker: string
  voice_id: string
  voice_name: string | null
  created_at: string
  updated_at: string
}

export async function fetchVoices() {
  const body = await getJson<{ voices: ApiVoice[] }>('/api/voices')
  return body.voices.map(fromApiVoice)
}

export async function createVoice(values: VoiceFormValues) {
  return fromApiVoice(
    await postForm<ApiVoice>('/api/voices', voiceFormData(values)),
  )
}

export async function updateVoice(voiceId: string, values: VoiceFormValues) {
  return fromApiVoice(
    await patchForm<ApiVoice>(`/api/voices/${voiceId}`, voiceFormData(values)),
  )
}

export async function deleteVoice(voiceId: string, options?: { force?: boolean }) {
  return deleteJson<{ deleted: number; removed_mappings: number }>(
    `/api/voices/${voiceId}${options?.force ? '?force=true' : ''}`,
  )
}

export async function createVoicePreview(voiceId: string) {
  return postJson<{
    voice_id: string
    sentence: string
    audio_path: string
    audio_url: string
  }>(`/api/voices/${voiceId}/preview`, {})
}

export async function generateVoiceAudio(voiceId: string, text: string) {
  return postJson<{
    voice_id: string
    text: string
    audio_path: string
    audio_url: string
  }>(`/api/voices/${voiceId}/workbench`, { text })
}

export async function fetchDocumentVoiceMappings(documentId: string) {
  const body = await getJson<{ mappings: ApiVoiceMapping[] }>(
    `/api/documents/${documentId}/voice-mappings`,
  )
  return body.mappings.map(fromApiVoiceMapping)
}

export async function upsertVoiceMapping(
  documentId: string,
  data: { speaker: string; voiceId: string },
) {
  return fromApiVoiceMapping(
    await postJson<ApiVoiceMapping>(
      `/api/documents/${documentId}/voice-mappings`,
      { speaker: data.speaker, voice_id: data.voiceId },
    ),
  )
}

export async function clearVoiceMapping(documentId: string, speaker: string) {
  return deleteJson<{ deleted: number }>(
    `/api/documents/${documentId}/voice-mappings/${encodeURIComponent(speaker)}`,
  )
}

function voiceFormData(values: VoiceFormValues) {
  const data = new FormData()
  if (values.voiceId) {
    data.append('voice_id', values.voiceId)
  }
  data.append('display_name', values.displayName)
  data.append('mode', values.mode)
  data.append('control_text', values.controlText ?? '')
  data.append('prompt_text', values.promptText ?? '')
  data.append('temperature', values.temperature.toString())
  if (values.referenceAudio && values.referenceAudio.size > 0) {
    data.append('reference_audio', values.referenceAudio)
  }
  if (values.promptAudio && values.promptAudio.size > 0) {
    data.append('prompt_audio', values.promptAudio)
  }
  return data
}

function fromApiVoice(voice: ApiVoice): Voice {
  return {
    id: voice.id,
    displayName: voice.display_name,
    mode: voice.mode,
    controlText: voice.control_text,
    referenceAudioPath: voice.reference_audio_path,
    promptAudioPath: voice.prompt_audio_path,
    promptText: voice.prompt_text,
    temperature: voice.temperature,
    isCanonical: voice.is_canonical,
    previewAudioPath: voice.preview_audio_path,
    previewSentence: voice.preview_sentence,
    createdAt: voice.created_at,
    updatedAt: voice.updated_at,
  }
}

function fromApiVoiceMapping(mapping: ApiVoiceMapping): VoiceMapping {
  return {
    id: mapping.id,
    documentId: mapping.document_id,
    speaker: mapping.speaker,
    voiceId: mapping.voice_id,
    voiceName: mapping.voice_name,
    createdAt: mapping.created_at,
    updatedAt: mapping.updated_at,
  }
}
