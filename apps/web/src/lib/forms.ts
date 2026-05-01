import { z } from 'zod'

export const ao3UrlFormSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Paste an AO3 URL first.')
    .url('Paste a valid URL.')
    .refine(
      (value) => {
        try {
          const url = new URL(value)
          return ['archiveofourown.org', 'www.archiveofourown.org'].includes(
            url.hostname,
          )
        } catch {
          return false
        }
      },
      {
        message: 'Use an archiveofourown.org URL.',
      },
    ),
})

export const titleFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(200, 'Name must be 200 characters or fewer.'),
})

export type Ao3UrlFormValues = z.infer<typeof ao3UrlFormSchema>
export type TitleFormValues = z.infer<typeof titleFormSchema>
