import { describe, expect, it } from 'vitest'

import { ao3UrlFormSchema, titleFormSchema } from './forms'

describe('form schemas', () => {
  it('accepts AO3 URLs', () => {
    const result = ao3UrlFormSchema.safeParse({
      url: 'https://archiveofourown.org/works/123',
    })

    expect(result.success).toBe(true)
  })

  it('rejects non-AO3 URLs', () => {
    const result = ao3UrlFormSchema.safeParse({
      url: 'https://example.com/works/123',
    })

    expect(result.success).toBe(false)
  })

  it('trims and validates titles', () => {
    const result = titleFormSchema.parse({
      title: '  Renamed Work  ',
    })

    expect(result.title).toBe('Renamed Work')
  })
})
