import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export const listWorks = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ db }, { works }, { desc }] = await Promise.all([
    import('./index.ts'),
    import('./schema.ts'),
    import('drizzle-orm'),
  ])

  return db
    .select({
      id: works.id,
      slug: works.slug,
      title: works.title,
      sourceType: works.sourceType,
      sourceId: works.sourceId,
      authors: works.authors,
      sourceMetadata: works.sourceMetadata,
      createdAt: works.createdAt,
      updatedAt: works.updatedAt,
    })
    .from(works)
    .orderBy(desc(works.updatedAt))
    .all()
})

const DeleteWorkInput = z.object({
  workId: z.string().min(1),
})

export const deleteWork = createServerFn({ method: 'POST' })
  .inputValidator(DeleteWorkInput)
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
        works,
      },
      { eq, inArray },
    ] = await Promise.all([
      import('./index.ts'),
      import('./schema.ts'),
      import('drizzle-orm'),
    ])

    return db.transaction((tx) => {
      const documentRows = tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.workId, data.workId))
        .all()
      const documentIds = documentRows.map((document) => document.id)

      if (documentIds.length > 0) {
        const spanRows = tx
          .select({ id: spans.id })
          .from(spans)
          .where(inArray(spans.documentId, documentIds))
          .all()
        const spanIds = spanRows.map((span) => span.id)

        const synthesisJobRows = tx
          .select({ id: synthesisJobs.id })
          .from(synthesisJobs)
          .where(inArray(synthesisJobs.documentId, documentIds))
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
          .where(inArray(ingestionJobs.documentId, documentIds))
          .run()
        tx.delete(synthesisJobs)
          .where(inArray(synthesisJobs.documentId, documentIds))
          .run()
        tx.delete(voiceMappings)
          .where(inArray(voiceMappings.documentId, documentIds))
          .run()
        tx.delete(attributionJobs)
          .where(inArray(attributionJobs.documentId, documentIds))
          .run()
        tx.delete(segmentationJobs)
          .where(inArray(segmentationJobs.documentId, documentIds))
          .run()
        tx.delete(spans).where(inArray(spans.documentId, documentIds)).run()
        tx.delete(documents).where(inArray(documents.id, documentIds)).run()
      }

      const result = tx.delete(works).where(eq(works.id, data.workId)).run()

      return { deleted: result.changes }
    })
  })
