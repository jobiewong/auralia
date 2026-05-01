import { describe, expect, it } from 'vitest'

import { getHiddenBookCount, getHomeBooks } from './books'

describe('book list helpers', () => {
  it('caps home books at five', () => {
    const books = ['one', 'two', 'three', 'four', 'five', 'six']

    expect(getHomeBooks(books)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ])
  })

  it('reports the hidden book count', () => {
    expect(getHiddenBookCount(6, 5)).toBe(1)
    expect(getHiddenBookCount(3, 3)).toBe(0)
  })
})
