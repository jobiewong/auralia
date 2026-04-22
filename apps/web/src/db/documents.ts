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

const UpdateSpanAttributionInput = z.object({
  spanId: z.string().min(1),
  speaker: z.string().trim().min(1),
  needsReview: z.boolean().default(false),
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
        .set({ updatedAt: now })
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
