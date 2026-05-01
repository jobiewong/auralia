type ApiErrorBody = {
  detail?: unknown
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  return handleJson<T>(response)
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson<T>(response)
}

export async function postForm<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(path, { method: 'POST', body })
  return handleJson<T>(response)
}

export async function patchForm<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(path, { method: 'PATCH', body })
  return handleJson<T>(response)
}

export async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'DELETE' })
  return handleJson<T>(response)
}

async function handleJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }
  return (await response.json()) as T
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody
    const detail = body.detail
    if (typeof detail === 'string') {
      return detail
    }
    if (typeof detail === 'object' && detail !== null) {
      if (
        'errors' in detail &&
        Array.isArray(detail.errors)
      ) {
        return detail.errors
          .map((error) =>
            typeof error === 'object' && error && 'message' in error
              ? String(error.message)
              : 'Request failed',
          )
          .join('; ')
      }
      if (
        'message' in detail &&
        typeof detail.message === 'string'
      ) {
        return detail.message
      }
    }
  } catch {
    // Fall back below.
  }
  return response.statusText || `Request failed with ${response.status}`
}
