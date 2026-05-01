import { describe, expect, it } from 'vitest'

import { getAo3WorkDraft, parseAo3Url } from './ao3'

describe('AO3 URL helpers', () => {
  it('parses chapter URLs', () => {
    expect(
      parseAo3Url('https://archiveofourown.org/works/123/chapters/456'),
    ).toEqual({
      kind: 'chapter',
      url: 'https://archiveofourown.org/works/123/chapters/456',
      workId: '123',
      chapterId: '456',
    })
  })

  it('builds work drafts for work URLs', () => {
    expect(getAo3WorkDraft('https://archiveofourown.org/works/123')).toEqual({
      title: 'AO3 Work 123',
      sourceType: 'ao3',
      sourceId: 'ao3:work:123',
      sourceMetadata:
        '{"source":"ao3","kind":"work","work_id":"123","work_title":null,"authors":[],"url":"https://archiveofourown.org/works/123"}',
    })
  })

  it('builds work drafts for series URLs', () => {
    expect(getAo3WorkDraft('https://archiveofourown.org/series/1031154'))
      .toEqual({
        title: 'AO3 Series 1031154',
        sourceType: 'ao3',
        sourceId: 'ao3:series:1031154',
        sourceMetadata:
          '{"source":"ao3","kind":"series","series_id":"1031154","series_title":null,"url":"https://archiveofourown.org/series/1031154"}',
      })
  })
})
