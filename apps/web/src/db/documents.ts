import { z } from 'zod'

export const ListWorkDocumentsInput = z.object({
  bookSlug: z.string().min(1),
})

export const ListDocumentSpansInput = z.object({
  bookSlug: z.string().min(1),
  documentId: z.string().min(1),
})

export const GetDocumentRouteTargetInput = z.object({
  documentId: z.string().min(1),
})

export const UpdateSpanAttributionInput = z.object({
  spanId: z.string().min(1),
  speaker: z.string().trim().min(1),
  needsReview: z.boolean().default(false),
})

export const CastCharacterInput = z.object({
  documentId: z.string().min(1),
  canonicalName: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  descriptor: z.string().trim().nullable().default(null),
})

export const UpdateCastCharacterInput = CastCharacterInput.extend({
  originalName: z.string().trim().min(1),
})

export const DeleteCastCharacterInput = z.object({
  documentId: z.string().min(1),
  canonicalName: z.string().trim().min(1),
})

export const UpdateDocumentTitleInput = z.object({
  documentId: z.string().min(1),
  title: z.string().trim().min(1),
})

export const DeleteDocumentInput = z.object({
  documentId: z.string().min(1),
})

export async function listWorkDocumentsQuery(data: z.infer<typeof ListWorkDocumentsInput>) {
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
}

export async function listDocumentSpansQuery(data: z.infer<typeof ListDocumentSpansInput>) {
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
}

export async function getDocumentRouteTargetQuery(data: z.infer<typeof GetDocumentRouteTargetInput>) {
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
}

export async function getDocumentDiagnosticsQuery(data: z.infer<typeof ListDocumentSpansInput>) {
  const [
    { db },
    {
      attributions,
      attributionJobs,
      castDetectionJobs,
      documents,
      documentCastMembers,
      ingestionJobs,
      segmentationJobs,
      spans,
      synthesisJobs,
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
  const castRows = db
    .select({
      canonicalName: documentCastMembers.canonicalName,
      aliases: documentCastMembers.aliases,
      descriptor: documentCastMembers.descriptor,
      confidence: documentCastMembers.confidence,
      needsReview: documentCastMembers.needsReview,
      source: documentCastMembers.source,
      manuallyEdited: documentCastMembers.manuallyEdited,
      manuallyDeleted: documentCastMembers.manuallyDeleted,
    })
    .from(documentCastMembers)
    .where(eq(documentCastMembers.documentId, data.documentId))
    .all()
    .filter((character) => character.canonicalName.length > 0)
  const latestSegmentationJob = db
    .select({
      id: segmentationJobs.id,
      status: segmentationJobs.status,
      chunkCount: segmentationJobs.chunkCount,
      modelName: segmentationJobs.modelName,
      stats: segmentationJobs.stats,
      errorReport: segmentationJobs.errorReport,
      completedAt: segmentationJobs.completedAt,
      createdAt: segmentationJobs.createdAt,
      updatedAt: segmentationJobs.updatedAt,
    })
    .from(segmentationJobs)
    .where(eq(segmentationJobs.documentId, data.documentId))
    .orderBy(desc(segmentationJobs.updatedAt))
    .get()
  const latestIngestionJob = db
    .select({
      id: ingestionJobs.id,
      status: ingestionJobs.status,
      errorReport: ingestionJobs.errorMessage,
      completedAt: ingestionJobs.completedAt,
      createdAt: ingestionJobs.createdAt,
      updatedAt: ingestionJobs.updatedAt,
    })
    .from(ingestionJobs)
    .where(eq(ingestionJobs.documentId, data.documentId))
    .orderBy(desc(ingestionJobs.updatedAt))
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
  const latestCastDetectionJob = db
    .select({
      id: castDetectionJobs.id,
      status: castDetectionJobs.status,
      modelName: castDetectionJobs.modelName,
      stats: castDetectionJobs.stats,
      errorReport: castDetectionJobs.errorReport,
      completedAt: castDetectionJobs.completedAt,
      createdAt: castDetectionJobs.createdAt,
      updatedAt: castDetectionJobs.updatedAt,
    })
    .from(castDetectionJobs)
    .where(eq(castDetectionJobs.documentId, data.documentId))
    .orderBy(desc(castDetectionJobs.updatedAt))
    .get()
  const latestSynthesisJob = db
    .select({
      id: synthesisJobs.id,
      status: synthesisJobs.status,
      outputPath: synthesisJobs.outputPath,
      completedAt: synthesisJobs.completedAt,
      createdAt: synthesisJobs.createdAt,
      updatedAt: synthesisJobs.updatedAt,
    })
    .from(synthesisJobs)
    .where(eq(synthesisJobs.documentId, data.documentId))
    .orderBy(desc(synthesisJobs.updatedAt))
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

  const activeCastRows = castRows.filter(
    (character) => !character.manuallyDeleted,
  )
  const rosterJson =
    activeCastRows.length > 0
      ? serializeRoster(
          activeCastRows.map((character) => ({
            canonicalName: character.canonicalName,
            aliases: parseAliasesJson(character.aliases),
            descriptor: character.descriptor || null,
          })),
        )
      : document.roster

  return {
    document: {
      ...document,
      roster: rosterJson,
    },
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
    castCounts: {
      total: activeCastRows.length,
      needsReview: activeCastRows.filter((character) => character.needsReview)
        .length,
      manuallyEdited: activeCastRows.filter(
        (character) => character.manuallyEdited,
      ).length,
    },
    latestIngestionJob: latestIngestionJob ?? null,
    latestSegmentationJob: latestSegmentationJob ?? null,
    latestCastDetectionJob: latestCastDetectionJob ?? null,
    latestAttributionJob: latestAttributionJob ?? null,
    latestSynthesisJob: latestSynthesisJob ?? null,
  }
}

export async function updateSpanAttributionQuery(data: z.infer<typeof UpdateSpanAttributionInput>) {
  const [
    { randomUUID },
    { db },
    { attributions, documentCastMembers, documents, spans, works },
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
    if (speaker !== 'UNKNOWN') {
      tx.insert(documentCastMembers)
        .values({
          id: randomUUID(),
          documentId: span.documentId,
          canonicalName: speaker,
          aliases: JSON.stringify([speaker]),
          descriptor: '',
          confidence: 1,
          needsReview: false,
          source: 'manual',
          manuallyEdited: true,
          manuallyDeleted: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            documentCastMembers.documentId,
            documentCastMembers.canonicalName,
          ],
          set: {
            confidence: 1,
            needsReview: false,
            manuallyEdited: true,
            manuallyDeleted: false,
            updatedAt: now,
          },
        })
        .run()
    }

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
}

export async function addCastCharacterQuery(data: z.infer<typeof CastCharacterInput>) {
  const [
    { randomUUID },
    { db },
    { documentCastMembers, documents, works },
    { eq },
  ] = await Promise.all([
    import('node:crypto'),
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
    tx.insert(documentCastMembers)
      .values({
        id: randomUUID(),
        documentId: data.documentId,
        canonicalName: data.canonicalName,
        aliases: JSON.stringify(data.aliases),
        descriptor: data.descriptor || '',
        confidence: 1,
        needsReview: false,
        source: 'manual',
        manuallyEdited: true,
        manuallyDeleted: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          documentCastMembers.documentId,
          documentCastMembers.canonicalName,
        ],
        set: {
          aliases: JSON.stringify(data.aliases),
          descriptor: data.descriptor || '',
          confidence: 1,
          needsReview: false,
          source: 'manual',
          manuallyEdited: true,
          manuallyDeleted: false,
          updatedAt: now,
        },
      })
      .run()

    if (document.workId) {
      tx.update(works)
        .set({ updatedAt: now })
        .where(eq(works.id, document.workId))
        .run()
    }

    return { canonicalName: data.canonicalName }
  })
}

export async function updateCastCharacterQuery(data: z.infer<typeof UpdateCastCharacterInput>) {
  const [
    { randomUUID },
    { db },
    { attributions, documentCastMembers, documents, spans, works },
    { and, eq, inArray },
  ] = await Promise.all([
    import('node:crypto'),
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
    tx.update(documentCastMembers)
      .set({
        canonicalName: data.canonicalName,
        aliases: JSON.stringify(data.aliases),
        descriptor: data.descriptor || '',
        confidence: 1,
        needsReview: false,
        source: 'manual',
        manuallyEdited: true,
        manuallyDeleted: false,
        updatedAt: now,
      })
      .where(
        and(
          eq(documentCastMembers.documentId, data.documentId),
          eq(documentCastMembers.canonicalName, data.originalName),
        ),
      )
      .run()
    tx.insert(documentCastMembers)
      .values({
        id: randomUUID(),
        documentId: data.documentId,
        canonicalName: data.canonicalName,
        aliases: JSON.stringify(data.aliases),
        descriptor: data.descriptor || '',
        confidence: 1,
        needsReview: false,
        source: 'manual',
        manuallyEdited: true,
        manuallyDeleted: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run()

    if (document.workId) {
      tx.update(works)
        .set({ updatedAt: now })
        .where(eq(works.id, document.workId))
        .run()
    }

    return { canonicalName: data.canonicalName }
  })
}

export async function deleteCastCharacterQuery(data: z.infer<typeof DeleteCastCharacterInput>) {
  const [{ db }, { documentCastMembers, documents, works }, { and, eq }] =
    await Promise.all([
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
    tx.update(documentCastMembers)
      .set({
        manuallyDeleted: true,
        manuallyEdited: true,
        updatedAt: now,
      })
      .where(
        and(
          eq(documentCastMembers.documentId, data.documentId),
          eq(documentCastMembers.canonicalName, data.canonicalName),
        ),
      )
      .run()

    if (document.workId) {
      tx.update(works)
        .set({ updatedAt: now })
        .where(eq(works.id, document.workId))
        .run()
    }

    return { canonicalName: data.canonicalName }
  })
}

export async function updateDocumentTitleQuery(data: z.infer<typeof UpdateDocumentTitleInput>) {
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
}

export async function deleteDocumentQuery(data: z.infer<typeof DeleteDocumentInput>) {
  const [
    { db },
    {
      attributions,
      attributionJobs,
      castDetectionJobs,
      castMemberEvidence,
      documents,
      documentCastMembers,
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
    tx.delete(castMemberEvidence)
      .where(eq(castMemberEvidence.documentId, data.documentId))
      .run()
    tx.delete(documentCastMembers)
      .where(eq(documentCastMembers.documentId, data.documentId))
      .run()
    tx.delete(castDetectionJobs)
      .where(eq(castDetectionJobs.documentId, data.documentId))
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
}

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

function parseAliasesJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((alias): alias is string => typeof alias === 'string')
      : []
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
