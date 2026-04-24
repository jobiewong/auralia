type ApiErrorBody = {
  detail?: unknown
}

export async function ingestAo3Chapter(
  url: string,
  options?: { sourceId?: string },
) {
  return postJson<{
    ingestion_job: { id: string; status: string }
    cleaned_document: { id: string }
  }>('/api/ingest/ao3', {
    url,
    source_id: options?.sourceId,
  })
}

export async function runSegmentation(documentId: string) {
  return postJson<{
    segmentation_job: { id: string; document_id: string; status: string }
  }>('/api/segment', { document_id: documentId })
}

export async function runAttribution(documentId: string) {
  return postJson<{
    attribution_job: { id: string; document_id: string; status: string }
  }>('/api/attribute', { document_id: documentId })
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }

  return (await response.json()) as T
}

async function getErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as ApiErrorBody
    const detail = body.detail

    if (typeof detail === 'string') {
      return detail
    }
    if (
      typeof detail === 'object' &&
      detail !== null &&
      'message' in detail &&
      typeof detail.message === 'string'
    ) {
      return detail.message
    }
  } catch {
    // Fall back to status text below.
  }

  return response.statusText || `Request failed with ${response.status}`
}
