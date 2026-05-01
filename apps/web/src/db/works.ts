import { z } from 'zod'

export const CreateWorkInput = z.object({
  title: z.string().trim().min(1),
  sourceType: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  sourceMetadata: z.string().nullable().default(null),
})

export const UpdateWorkTitleInput = z.object({
  workId: z.string().min(1),
  title: z.string().trim().min(1),
})

export const DeleteWorkInput = z.object({
  workId: z.string().min(1),
})

export async function listWorksQuery() {
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
}

export async function createWorkQuery(data: z.infer<typeof CreateWorkInput>) {
  const [{ randomUUID }, { db }, { works }, { and, eq }] = await Promise.all([
    import('node:crypto'),
    import('./index.ts'),
    import('./schema.ts'),
    import('drizzle-orm'),
  ])

  const existingWork = db
    .select({
      id: works.id,
      slug: works.slug,
    })
    .from(works)
    .where(
      and(eq(works.sourceType, data.sourceType), eq(works.sourceId, data.sourceId)),
    )
    .get()

  if (existingWork) {
    return existingWork
  }

  const workId = `work_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const baseSlug = slugify(data.title)
  let slug = baseSlug
  let suffix = 2

  while (
    db
      .select({ slug: works.slug })
      .from(works)
      .where(eq(works.slug, slug))
      .get()
  ) {
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }

  db.insert(works)
    .values({
      id: workId,
      slug,
      title: data.title,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      authors: null,
      sourceMetadata: data.sourceMetadata,
    })
    .run()

  return { id: workId, slug }
}

export async function updateWorkTitleQuery(data: z.infer<typeof UpdateWorkTitleInput>) {
  const [{ db }, { works }, { eq }] = await Promise.all([
    import('./index.ts'),
    import('./schema.ts'),
    import('drizzle-orm'),
  ])

  const now = new Date().toISOString()

  const result = db
    .update(works)
    .set({
      title: data.title.trim(),
      updatedAt: now,
    })
    .where(eq(works.id, data.workId))
    .run()

  return { updated: result.changes }
}

export async function deleteWorkQuery(data: z.infer<typeof DeleteWorkInput>) {
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
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'work'
}
