import { createServerFn } from '@tanstack/react-start'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const VoiceModeSchema = z.enum(['designed', 'clone', 'hifi_clone'])
const AllowedAudioExtensions = new Set(['.wav', '.mp3', '.flac', '.m4a', '.ogg'])
const PreviewSentences = [
  'The lanterns burned low as the last train crossed the valley.',
  'Every story leaves an echo if you listen closely enough.',
  'She opened the door and found the morning waiting on the other side.',
  'A quiet voice can still carry across an entire room.',
]

const VoiceIdInput = z.object({
  voiceId: z.string().min(1),
})

const DeleteVoiceInput = VoiceIdInput.extend({
  force: z.boolean().default(false),
})

const UpsertVoiceMappingInput = z.object({
  documentId: z.string().min(1),
  speaker: z.string().trim().min(1),
  voiceId: z.string().min(1),
})

const ClearVoiceMappingInput = z.object({
  documentId: z.string().min(1),
  speaker: z.string().trim().min(1),
})

const DocumentVoiceMappingsInput = z.object({
  documentId: z.string().min(1),
})

type VoiceMode = z.infer<typeof VoiceModeSchema>

export type VoiceProfile = {
  id: string
  displayName: string
  mode: VoiceMode
  controlText: string | null
  referenceAudioPath: string | null
  promptAudioPath: string | null
  promptText: string | null
  cfgValue: number
  inferenceTimesteps: number
  isCanonical: boolean
  createdAt: string
  updatedAt: string
}

export type VoiceValidationIssue = {
  code: string
  field: string | null
  message: string
}

export type VoiceValidationReport = {
  voiceId: string
  valid: boolean
  errors: VoiceValidationIssue[]
  warnings: VoiceValidationIssue[]
}

export const listVoices = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ db }, { voices }, { asc }] = await Promise.all([
    import('./index.ts'),
    import('./schema.ts'),
    import('drizzle-orm'),
  ])

  return db.select().from(voices).orderBy(asc(voices.displayName)).all()
})

export const createVoice = createServerFn({ method: 'POST' })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }) => {
    const [{ db }, { voices }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
    ])
    const voice = await formDataToVoice(data)
    const voiceDir = voiceDirPath(voice.id)
    await fs.mkdir(voiceDir, { recursive: true })
    const referenceAudio = data.get('referenceAudio')
    const promptAudio = data.get('promptAudio')

    if (referenceAudio instanceof File && referenceAudio.size > 0) {
      voice.referenceAudioPath = await saveUpload(referenceAudio, voice.id, 'reference')
    }
    if (promptAudio instanceof File && promptAudio.size > 0) {
      voice.promptAudioPath = await saveUpload(promptAudio, voice.id, 'prompt')
    }

    const report = await validateVoiceData(voice)
    if (!report.valid) {
      await fs.rm(voiceDir, { force: true, recursive: true })
      throw new Error(report.errors.map((error) => error.message).join('; '))
    }

    db.insert(voices).values(voice).run()
    return voice
  })

export const updateVoice = createServerFn({ method: 'POST' })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }) => {
    const [{ db }, { voices }, { eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const voiceId = String(data.get('voiceId') ?? '')
    if (!voiceId) {
      throw new Error('voiceId is required')
    }
    const existing = db.select().from(voices).where(eq(voices.id, voiceId)).get()
    if (!existing) {
      throw new Error('Voice not found')
    }
    const next = await formDataToVoice(data, existing)
    next.id = voiceId
    next.createdAt = existing.createdAt
    next.referenceAudioPath = existing.referenceAudioPath
    next.promptAudioPath = existing.promptAudioPath
    const referenceAudio = data.get('referenceAudio')
    const promptAudio = data.get('promptAudio')
    if (referenceAudio instanceof File && referenceAudio.size > 0) {
      next.referenceAudioPath = await saveUpload(referenceAudio, voiceId, 'reference')
    }
    if (promptAudio instanceof File && promptAudio.size > 0) {
      next.promptAudioPath = await saveUpload(promptAudio, voiceId, 'prompt')
    }
    const report = await validateVoiceData(next)
    if (!report.valid) {
      throw new Error(report.errors.map((error) => error.message).join('; '))
    }
    db.update(voices).set(next).where(eq(voices.id, voiceId)).run()
    return next
  })

export const deleteVoice = createServerFn({ method: 'POST' })
  .inputValidator(DeleteVoiceInput)
  .handler(async ({ data }) => {
    const [{ db }, { voiceMappings, voices }, { eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const mappingRows = db
      .select({ id: voiceMappings.id })
      .from(voiceMappings)
      .where(eq(voiceMappings.voiceId, data.voiceId))
      .all()
    if (mappingRows.length > 0 && !data.force) {
      throw new Error(`Voice is used by ${mappingRows.length} mapping(s)`)
    }
    return db.transaction((tx) => {
      if (data.force) {
        tx.delete(voiceMappings).where(eq(voiceMappings.voiceId, data.voiceId)).run()
      }
      const result = tx.delete(voices).where(eq(voices.id, data.voiceId)).run()
      return { deleted: result.changes, removedMappings: data.force ? mappingRows.length : 0 }
    })
  })

export const validateVoice = createServerFn({ method: 'POST' })
  .inputValidator(VoiceIdInput)
  .handler(async ({ data }) => {
    const [{ db }, { voices }, { eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const voice = db.select().from(voices).where(eq(voices.id, data.voiceId)).get()
    if (!voice) {
      throw new Error('Voice not found')
    }
    return validateVoiceData(voice)
  })

export const createVoicePreview = createServerFn({ method: 'POST' })
  .inputValidator(VoiceIdInput)
  .handler(async ({ data }) => {
    const [{ db }, { voices }, { eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const voice = db.select().from(voices).where(eq(voices.id, data.voiceId)).get()
    if (!voice) {
      throw new Error('Voice not found')
    }
    const report = await validateVoiceData(voice)
    if (!report.valid) {
      throw new Error(report.errors.map((error) => error.message).join('; '))
    }
    const sentence = PreviewSentences[Math.floor(Math.random() * PreviewSentences.length)]
    const previewsDir = path.join(voiceDirPath(data.voiceId), 'previews')
    await fs.mkdir(previewsDir, { recursive: true })
    const fileName = `preview_${crypto.randomUUID().replaceAll('-', '')}.wav`
    const absolutePath = path.join(previewsDir, fileName)
    await fs.writeFile(absolutePath, makeSilentWav())
    return {
      voiceId: data.voiceId,
      sentence,
      audioPath: path.relative(repoRoot(), absolutePath),
      audioUrl: `/api/voices/${data.voiceId}/preview-file/${fileName}`,
    }
  })

export const listDocumentVoiceMappings = createServerFn({ method: 'GET' })
  .inputValidator(DocumentVoiceMappingsInput)
  .handler(async ({ data }) => {
    const [{ db }, { voiceMappings, voices }, { eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    return db
      .select({
        id: voiceMappings.id,
        documentId: voiceMappings.documentId,
        speaker: voiceMappings.speaker,
        voiceId: voiceMappings.voiceId,
        voiceName: voices.displayName,
      })
      .from(voiceMappings)
      .innerJoin(voices, eq(voiceMappings.voiceId, voices.id))
      .where(eq(voiceMappings.documentId, data.documentId))
      .all()
  })

export const upsertVoiceMapping = createServerFn({ method: 'POST' })
  .inputValidator(UpsertVoiceMappingInput)
  .handler(async ({ data }) => {
    const [{ db }, { voiceMappings, voices }, { and, eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const voice = db.select({ id: voices.id }).from(voices).where(eq(voices.id, data.voiceId)).get()
    if (!voice) {
      throw new Error('Voice not found')
    }
    const now = new Date().toISOString()
    const existing = db
      .select({ id: voiceMappings.id })
      .from(voiceMappings)
      .where(and(eq(voiceMappings.documentId, data.documentId), eq(voiceMappings.speaker, data.speaker)))
      .get()
    if (existing) {
      db.update(voiceMappings)
        .set({ voiceId: data.voiceId, updatedAt: now })
        .where(eq(voiceMappings.id, existing.id))
        .run()
      return { updated: 1 }
    }
    db.insert(voiceMappings)
      .values({
        id: `voice_mapping_${crypto.randomUUID().replaceAll('-', '')}`,
        documentId: data.documentId,
        speaker: data.speaker,
        voiceId: data.voiceId,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return { created: 1 }
  })

export const clearVoiceMapping = createServerFn({ method: 'POST' })
  .inputValidator(ClearVoiceMappingInput)
  .handler(async ({ data }) => {
    const [{ db }, { voiceMappings }, { and, eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const result = db
      .delete(voiceMappings)
      .where(and(eq(voiceMappings.documentId, data.documentId), eq(voiceMappings.speaker, data.speaker)))
      .run()
    return { deleted: result.changes }
  })

async function formDataToVoice(data: FormData, existing?: VoiceProfile): Promise<VoiceProfile> {
  const now = new Date().toISOString()
  const mode = VoiceModeSchema.parse(String(data.get('mode') ?? existing?.mode ?? 'designed'))
  return {
    id: existing?.id ?? `voice_${crypto.randomUUID().replaceAll('-', '')}`,
    displayName: String(data.get('displayName') ?? existing?.displayName ?? '').trim(),
    mode,
    controlText: cleanOptional(data.get('controlText') ?? existing?.controlText ?? null),
    referenceAudioPath: existing?.referenceAudioPath ?? null,
    promptAudioPath: existing?.promptAudioPath ?? null,
    promptText: cleanOptional(data.get('promptText') ?? existing?.promptText ?? null),
    cfgValue: Number(data.get('cfgValue') ?? existing?.cfgValue ?? 2),
    inferenceTimesteps: Number(data.get('inferenceTimesteps') ?? existing?.inferenceTimesteps ?? 10),
    isCanonical: true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

async function saveUpload(file: File, voiceId: string, stem: string) {
  const ext = path.extname(file.name).toLowerCase()
  if (!AllowedAudioExtensions.has(ext)) {
    throw new Error('Unsupported audio extension')
  }
  const target = path.join(voiceDirPath(voiceId), `${stem}${ext}`)
  assertInsideVoiceRoot(target)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, Buffer.from(await file.arrayBuffer()))
  if ((await fs.stat(target)).size === 0) {
    await fs.rm(target, { force: true })
    throw new Error('Uploaded audio file is empty')
  }
  return path.relative(voiceRoot(), target)
}

async function validateVoiceData(voice: VoiceProfile): Promise<VoiceValidationReport> {
  const errors: VoiceValidationIssue[] = []
  const warnings: VoiceValidationIssue[] = []
  if (!voice.displayName.trim()) {
    errors.push(issue('missing_display_name', 'displayName', 'Name is required'))
  }
  if (voice.mode === 'designed' && !voice.controlText?.trim()) {
    errors.push(issue('missing_control_text', 'controlText', 'Designed voices require control text'))
  }
  if (voice.mode === 'clone') {
    await validateAsset(voice.referenceAudioPath, 'referenceAudioPath', errors)
  }
  if (voice.mode === 'hifi_clone') {
    await validateAsset(voice.promptAudioPath, 'promptAudioPath', errors)
    if (!voice.promptText?.trim()) {
      errors.push(issue('missing_prompt_text', 'promptText', 'Hi-fi clone voices require prompt text'))
    }
  }
  if (voice.cfgValue < 0.1 || voice.cfgValue > 10) {
    errors.push(issue('invalid_cfg_value', 'cfgValue', 'CFG must be between 0.1 and 10'))
  }
  if (voice.inferenceTimesteps < 1 || voice.inferenceTimesteps > 100) {
    errors.push(issue('invalid_inference_timesteps', 'inferenceTimesteps', 'Inference timesteps must be between 1 and 100'))
  }
  return { voiceId: voice.id, valid: errors.length === 0, errors, warnings }
}

async function validateAsset(relPath: string | null, field: string, errors: VoiceValidationIssue[]) {
  if (!relPath) {
    errors.push(issue(`missing_${field}`, field, `${field} is required`))
    return
  }
  const absolutePath = path.join(voiceRoot(), relPath)
  if (!assertInsideVoiceRoot(absolutePath)) {
    errors.push(issue('unsafe_asset_path', field, 'Asset path must stay inside voice storage'))
    return
  }
  if (!AllowedAudioExtensions.has(path.extname(absolutePath).toLowerCase())) {
    errors.push(issue('invalid_audio_extension', field, 'Unsupported audio extension'))
  }
  try {
    const stat = await fs.stat(absolutePath)
    if (stat.size === 0) {
      errors.push(issue('empty_audio_file', field, 'Audio file is empty'))
    }
  } catch {
    errors.push(issue('missing_audio_file', field, 'Audio file does not exist'))
  }
}

function makeSilentWav() {
  const sampleRate = 16_000
  const samples = sampleRate
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

function issue(code: string, field: string | null, message: string): VoiceValidationIssue {
  return { code, field, message }
}

function cleanOptional(value: FormDataEntryValue | string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

function voiceDirPath(voiceId: string) {
  const target = path.join(voiceRoot(), voiceId)
  assertInsideVoiceRoot(target)
  return target
}

function voiceRoot() {
  const configured = process.env.AURALIA_VOICE_STORAGE_PATH ?? 'data/voices'
  return path.isAbsolute(configured) ? configured : path.join(repoRoot(), configured)
}

function repoRoot() {
  return path.resolve(new URL('../../../..', import.meta.url).pathname)
}

function assertInsideVoiceRoot(target: string) {
  const root = path.resolve(voiceRoot())
  const resolved = path.resolve(target)
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    return true
  }
  throw new Error('Path escapes voice storage')
}
