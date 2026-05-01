export type VoiceMode = 'designed' | 'clone' | 'hifi_clone'

export type VoiceFormValues = {
  voiceId?: string
  displayName: string
  mode: VoiceMode
  controlText?: string
  referenceAudio?: File
  promptAudio?: File
  promptText?: string
  temperature: number
}
