export function getHomeBooks<T>(books: ReadonlyArray<T>, limit = 5) {
  return books.slice(0, limit)
}

export function getHiddenBookCount(totalBooks: number, visibleBooks: number) {
  return Math.max(totalBooks - visibleBooks, 0)
}
