import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const ListWorkDocumentsInput = z.object({
  bookSlug: z.string().min(1),
})

export const listWorkDocuments = createServerFn({ method: 'GET' })
  .inputValidator(ListWorkDocumentsInput)
  .handler(async ({ data }) => {
    const [{ db }, { documents, spans, works }, { asc, count, eq }] =
      await Promise.all([
        import('./index.ts'),
        import('./schema.ts'),
        import('drizzle-orm'),
      ])

    return db
      .select({
        id: documents.id,
        workId: documents.workId,
        sourceId: documents.sourceId,
        chapterId: documents.chapterId,
        title: documents.title,
        textLength: documents.textLength,
        sourceMetadata: documents.sourceMetadata,
        spanCount: count(spans.id),
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .innerJoin(works, eq(documents.workId, works.id))
      .leftJoin(spans, eq(spans.documentId, documents.id))
      .where(eq(works.slug, data.bookSlug))
      .groupBy(
        documents.id,
        documents.workId,
        documents.sourceId,
        documents.chapterId,
        documents.title,
        documents.textLength,
        documents.sourceMetadata,
        documents.createdAt,
        documents.updatedAt,
      )
      .orderBy(asc(documents.createdAt), asc(documents.chapterId))
      .all()
  })

const ListDocumentSpansInput = z.object({
  bookSlug: z.string().min(1),
  documentId: z.string().min(1),
})

const GetDocumentRouteTargetInput = z.object({
  documentId: z.string().min(1),
})

const UpdateSpanAttributionInput = z.object({
  spanId: z.string().min(1),
  speaker: z.string().trim().min(1),
  needsReview: z.boolean().default(false),
})

const CastCharacterInput = z.object({
  documentId: z.string().min(1),
  canonicalName: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  descriptor: z.string().trim().nullable().default(null),
})

const UpdateCastCharacterInput = CastCharacterInput.extend({
  originalName: z.string().trim().min(1),
})

const DeleteCastCharacterInput = z.object({
  documentId: z.string().min(1),
  canonicalName: z.string().trim().min(1),
})

const UpdateDocumentTitleInput = z.object({
  documentId: z.string().min(1),
  title: z.string().trim().min(1),
})

export const listDocumentSpans = createServerFn({ method: 'GET' })
  .inputValidator(ListDocumentSpansInput)
  .handler(async ({ data }) => {
    const [
      { db },
      { attributions, documents, spans, works },
      { asc, and, eq },
    ] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])

    return db
      .select({
        id: spans.id,
        documentId: spans.documentId,
        type: spans.type,
        text: spans.text,
        start: spans.start,
        end: spans.end,
        speaker: attributions.speaker,
        speakerConfidence: attributions.speakerConfidence,
        needsReview: attributions.needsReview,
        createdAt: spans.createdAt,
        updatedAt: spans.updatedAt,
      })
      .from(spans)
      .innerJoin(documents, eq(spans.documentId, documents.id))
      .innerJoin(works, eq(documents.workId, works.id))
      .leftJoin(attributions, eq(attributions.spanId, spans.id))
      .where(
        and(eq(works.slug, data.bookSlug), eq(documents.id, data.documentId)),
      )
      .orderBy(asc(spans.start), asc(spans.end))
      .all()
  })

export const getDocumentRouteTarget = createServerFn({ method: 'GET' })
  .inputValidator(GetDocumentRouteTargetInput)
  .handler(async ({ data }) => {
    const [{ db }, { documents, works }, { eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])

    const row = db
      .select({
        bookSlug: works.slug,
        documentId: documents.id,
      })
      .from(documents)
      .innerJoin(works, eq(documents.workId, works.id))
      .where(eq(documents.id, data.documentId))
      .get()

    if (!row) {
      throw new Error('Imported document was not found in the library')
    }

    return row
  })

export const getDocumentDiagnostics = createServerFn({ method: 'GET' })
  .inputValidator(ListDocumentSpansInput)
  .handler(async ({ data }) => {
    const [
      { db },
      {
        attributions,
        attributionJobs,
        documents,
        segmentationJobs,
        spans,
        works,
      },
      { and, desc, eq },
    ] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])

    const document = db
      .select({
        id: documents.id,
        roster: documents.roster,
        sourceMetadata: documents.sourceMetadata,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .innerJoin(works, eq(documents.workId, works.id))
      .where(
        and(eq(works.slug, data.bookSlug), eq(documents.id, data.documentId)),
      )
      .get()

    if (!document) {
      return null
    }

    const spanRows = db
      .select({
        id: spans.id,
        type: spans.type,
      })
      .from(spans)
      .where(eq(spans.documentId, data.documentId))
      .all()
    const attributionRows = db
      .select({
        speaker: attributions.speaker,
        speakerConfidence: attributions.speakerConfidence,
        needsReview: attributions.needsReview,
      })
      .from(attributions)
      .innerJoin(spans, eq(attributions.spanId, spans.id))
      .where(eq(spans.documentId, data.documentId))
      .all()
    const latestSegmentationJob = db
      .select({
        id: segmentationJobs.id,
        status: segmentationJobs.status,
        chunkCount: segmentationJobs.chunkCount,
        modelName: segmentationJobs.modelName,
        stats: segmentationJobs.stats,
        errorReport: segmentationJobs.errorReport,
        createdAt: segmentationJobs.createdAt,
        updatedAt: segmentationJobs.updatedAt,
      })
      .from(segmentationJobs)
      .where(eq(segmentationJobs.documentId, data.documentId))
      .orderBy(desc(segmentationJobs.updatedAt))
      .get()
    const latestAttributionJob = db
      .select({
        id: attributionJobs.id,
        status: attributionJobs.status,
        modelName: attributionJobs.modelName,
        stats: attributionJobs.stats,
        errorReport: attributionJobs.errorReport,
        completedAt: attributionJobs.completedAt,
        createdAt: attributionJobs.createdAt,
        updatedAt: attributionJobs.updatedAt,
      })
      .from(attributionJobs)
      .where(eq(attributionJobs.documentId, data.documentId))
      .orderBy(desc(attributionJobs.updatedAt))
      .get()

    const dialogueCount = spanRows.filter(
      (span) => span.type === 'dialogue',
    ).length
    const narrationCount = spanRows.length - dialogueCount
    const needsReviewCount = attributionRows.filter(
      (attribution) => attribution.needsReview,
    ).length
    const unknownCount = attributionRows.filter(
      (attribution) => attribution.speaker === 'UNKNOWN',
    ).length
    const averageConfidence =
      attributionRows.length === 0
        ? null
        : attributionRows.reduce(
            (total, attribution) => total + attribution.speakerConfidence,
            0,
          ) / attributionRows.length

    return {
      document,
      spanCounts: {
        total: spanRows.length,
        dialogue: dialogueCount,
        narration: narrationCount,
      },
      attributionCounts: {
        attributed: attributionRows.length,
        needsReview: needsReviewCount,
        unknown: unknownCount,
        averageConfidence,
      },
      latestSegmentationJob: latestSegmentationJob ?? null,
      latestAttributionJob: latestAttributionJob ?? null,
    }
  })

export const updateSpanAttribution = createServerFn({ method: 'POST' })
  .inputValidator(UpdateSpanAttributionInput)
  .handler(async ({ data }) => {
    const [
      { randomUUID },
      { db },
      { attributions, documents, spans, works },
      { eq },
    ] = await Promise.all([
      import('node:crypto'),
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const now = new Date().toISOString()
    const speaker = data.speaker.trim()
    const speakerConfidence = speaker === 'UNKNOWN' ? 0 : 1

    return db.transaction((tx) => {
      const span = tx
        .select({
          id: spans.id,
          documentId: spans.documentId,
          workId: documents.workId,
          roster: documents.roster,
        })
        .from(spans)
        .innerJoin(documents, eq(spans.documentId, documents.id))
        .where(eq(spans.id, data.spanId))
        .get()

      if (!span) {
        throw new Error('Span not found')
      }

      const existingAttribution = tx
        .select({ id: attributions.id })
        .from(attributions)
        .where(eq(attributions.spanId, data.spanId))
        .get()

      if (existingAttribution) {
        tx.update(attributions)
          .set({
            speaker,
            speakerConfidence,
            needsReview: data.needsReview,
            updatedAt: now,
          })
          .where(eq(attributions.id, existingAttribution.id))
          .run()
      } else {
        tx.insert(attributions)
          .values({
            id: randomUUID(),
            spanId: data.spanId,
            speaker,
            speakerConfidence,
            needsReview: data.needsReview,
            createdAt: now,
            updatedAt: now,
          })
          .run()
      }

      tx.update(spans)
        .set({ updatedAt: now })
        .where(eq(spans.id, data.spanId))
        .run()
      tx.update(documents)
        .set({
          roster: addRosterCharacter(span.roster, speaker),
          updatedAt: now,
        })
        .where(eq(documents.id, span.documentId))
        .run()

      if (span.workId) {
        tx.update(works)
          .set({ updatedAt: now })
          .where(eq(works.id, span.workId))
          .run()
      }

      return {
        spanId: data.spanId,
        speaker,
        speakerConfidence,
        needsReview: data.needsReview,
      }
    })
  })

export const addCastCharacter = createServerFn({ method: 'POST' })
  .inputValidator(CastCharacterInput)
  .handler(async ({ data }) => {
    const [{ db }, { documents, works }, { eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const now = new Date().toISOString()

    return db.transaction((tx) => {
      const document = tx
        .select({
          id: documents.id,
          workId: documents.workId,
          roster: documents.roster,
        })
        .from(documents)
        .where(eq(documents.id, data.documentId))
        .get()

      if (!document) {
        throw new Error('Document not found')
      }

      tx.update(documents)
        .set({
          roster: upsertRosterCharacter(document.roster, {
            canonicalName: data.canonicalName,
            aliases: data.aliases,
            descriptor: data.descriptor || null,
          }),
          updatedAt: now,
        })
        .where(eq(documents.id, data.documentId))
        .run()

      if (document.workId) {
        tx.update(works)
          .set({ updatedAt: now })
          .where(eq(works.id, document.workId))
          .run()
      }

      return { canonicalName: data.canonicalName }
    })
  })

export const updateCastCharacter = createServerFn({ method: 'POST' })
  .inputValidator(UpdateCastCharacterInput)
  .handler(async ({ data }) => {
    const [
      { db },
      { attributions, documents, spans, works },
      { and, eq, inArray },
    ] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const now = new Date().toISOString()

    return db.transaction((tx) => {
      const document = tx
        .select({
          id: documents.id,
          workId: documents.workId,
          roster: documents.roster,
        })
        .from(documents)
        .where(eq(documents.id, data.documentId))
        .get()

      if (!document) {
        throw new Error('Document not found')
      }

      const spanRows = tx
        .select({ id: spans.id })
        .from(spans)
        .where(eq(spans.documentId, data.documentId))
        .all()
      const spanIds = spanRows.map((span) => span.id)

      if (spanIds.length > 0 && data.originalName !== data.canonicalName) {
        tx.update(attributions)
          .set({ speaker: data.canonicalName, updatedAt: now })
          .where(
            and(
              inArray(attributions.spanId, spanIds),
              eq(attributions.speaker, data.originalName),
            ),
          )
          .run()
      }

      tx.update(documents)
        .set({
          roster: renameRosterCharacter(document.roster, data.originalName, {
            canonicalName: data.canonicalName,
            aliases: data.aliases,
            descriptor: data.descriptor || null,
          }),
          updatedAt: now,
        })
        .where(eq(documents.id, data.documentId))
        .run()

      if (document.workId) {
        tx.update(works)
          .set({ updatedAt: now })
          .where(eq(works.id, document.workId))
          .run()
      }

      return { canonicalName: data.canonicalName }
    })
  })

export const deleteCastCharacter = createServerFn({ method: 'POST' })
  .inputValidator(DeleteCastCharacterInput)
  .handler(async ({ data }) => {
    const [{ db }, { documents, works }, { eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const now = new Date().toISOString()

    return db.transaction((tx) => {
      const document = tx
        .select({
          id: documents.id,
          workId: documents.workId,
          roster: documents.roster,
        })
        .from(documents)
        .where(eq(documents.id, data.documentId))
        .get()

      if (!document) {
        throw new Error('Document not found')
      }

      tx.update(documents)
        .set({
          roster: deleteRosterCharacter(document.roster, data.canonicalName),
          updatedAt: now,
        })
        .where(eq(documents.id, data.documentId))
        .run()

      if (document.workId) {
        tx.update(works)
          .set({ updatedAt: now })
          .where(eq(works.id, document.workId))
          .run()
      }

      return { canonicalName: data.canonicalName }
    })
  })

export const updateDocumentTitle = createServerFn({ method: 'POST' })
  .inputValidator(UpdateDocumentTitleInput)
  .handler(async ({ data }) => {
    const [{ db }, { documents, works }, { eq }] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])
    const now = new Date().toISOString()

    return db.transaction((tx) => {
      const document = tx
        .select({
          id: documents.id,
          workId: documents.workId,
        })
        .from(documents)
        .where(eq(documents.id, data.documentId))
        .get()

      if (!document) {
        throw new Error('Document not found')
      }

      tx.update(documents)
        .set({
          title: data.title.trim(),
          updatedAt: now,
        })
        .where(eq(documents.id, data.documentId))
        .run()

      if (document.workId) {
        tx.update(works)
          .set({ updatedAt: now })
          .where(eq(works.id, document.workId))
          .run()
      }

      return { updated: 1 }
    })
  })

const DeleteDocumentInput = z.object({
  documentId: z.string().min(1),
})

export const deleteDocument = createServerFn({ method: 'POST' })
  .inputValidator(DeleteDocumentInput)
  .handler(async ({ data }) => {
    const [
      { db },
      {
        attributions,
        attributionJobs,
        documents,
        ingestionJobs,
        segmentationJobs,
        spans,
        synthesisJobs,
        synthesisSegments,
        voiceMappings,
      },
      { eq, inArray },
    ] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])

    return db.transaction((tx) => {
      const spanRows = tx
        .select({ id: spans.id })
        .from(spans)
        .where(eq(spans.documentId, data.documentId))
        .all()
      const spanIds = spanRows.map((span) => span.id)

      const synthesisJobRows = tx
        .select({ id: synthesisJobs.id })
        .from(synthesisJobs)
        .where(eq(synthesisJobs.documentId, data.documentId))
        .all()
      const synthesisJobIds = synthesisJobRows.map((job) => job.id)

      if (synthesisJobIds.length > 0) {
        tx.delete(synthesisSegments)
          .where(inArray(synthesisSegments.jobId, synthesisJobIds))
          .run()
      }

      if (spanIds.length > 0) {
        tx.delete(synthesisSegments)
          .where(inArray(synthesisSegments.spanId, spanIds))
          .run()
        tx.delete(attributions)
          .where(inArray(attributions.spanId, spanIds))
          .run()
      }

      tx.update(ingestionJobs)
        .set({ documentId: null })
        .where(eq(ingestionJobs.documentId, data.documentId))
        .run()
      tx.delete(synthesisJobs)
        .where(eq(synthesisJobs.documentId, data.documentId))
        .run()
      tx.delete(voiceMappings)
        .where(eq(voiceMappings.documentId, data.documentId))
        .run()
      tx.delete(attributionJobs)
        .where(eq(attributionJobs.documentId, data.documentId))
        .run()
      tx.delete(segmentationJobs)
        .where(eq(segmentationJobs.documentId, data.documentId))
        .run()
      tx.delete(spans).where(eq(spans.documentId, data.documentId)).run()

      const result = tx
        .delete(documents)
        .where(eq(documents.id, data.documentId))
        .run()

      return { deleted: result.changes }
    })
  })

type RosterCharacter = {
  canonicalName: string
  aliases: string[]
  descriptor: string | null
}

function addRosterCharacter(rosterJson: string | null, speaker: string) {
  if (speaker === 'UNKNOWN') {
    return rosterJson
  }
  const roster = parseRosterJson(rosterJson)
  const exists = roster.some(
    (character) =>
      character.canonicalName.toLowerCase() === speaker.toLowerCase(),
  )
  if (exists) {
    return serializeRoster(roster)
  }
  return serializeRoster([
    ...roster,
    normalizeRosterCharacter({
      canonicalName: speaker,
      aliases: [],
      descriptor: null,
    }),
  ])
}

function upsertRosterCharacter(
  rosterJson: string | null,
  character: RosterCharacter,
) {
  const roster = parseRosterJson(rosterJson)
  const index = roster.findIndex(
    (item) =>
      item.canonicalName.toLowerCase() === character.canonicalName.toLowerCase(),
  )
  const nextCharacter = normalizeRosterCharacter(character)

  if (index === -1) {
    return serializeRoster([...roster, nextCharacter])
  }

  const nextRoster = [...roster]
  nextRoster[index] = {
    ...nextRoster[index],
    aliases: nextCharacter.aliases,
    descriptor: nextCharacter.descriptor,
  }
  return serializeRoster(nextRoster)
}

function renameRosterCharacter(
  rosterJson: string | null,
  originalName: string,
  character: RosterCharacter,
) {
  const roster = parseRosterJson(rosterJson)
  const withoutOriginal = roster.filter(
    (item) => item.canonicalName !== originalName,
  )
  const withoutDuplicate = withoutOriginal.filter(
    (item) =>
      item.canonicalName.toLowerCase() !== character.canonicalName.toLowerCase(),
  )
  return serializeRoster([
    ...withoutDuplicate,
    normalizeRosterCharacter(character),
  ])
}

function deleteRosterCharacter(rosterJson: string | null, canonicalName: string) {
  return serializeRoster(
    parseRosterJson(rosterJson).filter(
      (character) => character.canonicalName !== canonicalName,
    ),
  )
}

function parseRosterJson(rosterJson: string | null) {
  if (!rosterJson) {
    return []
  }

  try {
    const parsed = JSON.parse(rosterJson) as unknown
    const roster = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && 'characters' in parsed
        ? (parsed as { characters?: unknown }).characters
        : null

    if (!Array.isArray(roster)) {
      return []
    }

    return roster.flatMap((character): RosterCharacter[] => {
      if (typeof character !== 'object' || character === null) {
        return []
      }
      const record = character as Record<string, unknown>
      const canonicalName =
        typeof record.canonical_name === 'string'
          ? record.canonical_name
          : typeof record.canonicalName === 'string'
            ? record.canonicalName
            : null

      if (!canonicalName) {
        return []
      }

      return [
        normalizeRosterCharacter({
          canonicalName,
          aliases: Array.isArray(record.aliases)
            ? record.aliases.filter(
                (alias): alias is string => typeof alias === 'string',
              )
            : [],
          descriptor:
            typeof record.descriptor === 'string' ? record.descriptor : null,
        }),
      ]
    })
  } catch {
    return []
  }
}

function normalizeRosterCharacter(character: RosterCharacter) {
  return {
    canonicalName: character.canonicalName.trim(),
    aliases: Array.from(
      new Set(
        character.aliases
          .map((alias) => alias.trim())
          .filter((alias) => alias.length > 0),
      ),
    ),
    descriptor: character.descriptor?.trim() || null,
  }
}

function serializeRoster(roster: RosterCharacter[]) {
  return JSON.stringify({
    characters: roster
      .filter((character) => character.canonicalName.length > 0)
      .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
      .map((character) => ({
        canonical_name: character.canonicalName,
        aliases: character.aliases,
        descriptor: character.descriptor,
      })),
  })
}
