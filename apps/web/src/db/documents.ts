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

export const listDocumentSpans = createServerFn({ method: 'GET' })
  .inputValidator(ListDocumentSpansInput)
  .handler(async ({ data }) => {
    const [{ db }, { documents, spans, works }, { asc, and, eq }] =
      await Promise.all([
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
        createdAt: spans.createdAt,
        updatedAt: spans.updatedAt,
      })
      .from(spans)
      .innerJoin(documents, eq(spans.documentId, documents.id))
      .innerJoin(works, eq(documents.workId, works.id))
      .where(
        and(eq(works.slug, data.bookSlug), eq(documents.id, data.documentId)),
      )
      .orderBy(asc(spans.start), asc(spans.end))
      .all()
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
