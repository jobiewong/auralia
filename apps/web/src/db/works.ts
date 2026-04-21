import { createServerFn } from '@tanstack/react-start'

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
      createdAt: works.createdAt,
      updatedAt: works.updatedAt,
    })
    .from(works)
    .orderBy(desc(works.updatedAt))
    .all()
})
