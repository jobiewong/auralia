import { postJson } from '~/lib/http'

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

export async function runSegmentation(
  documentId: string,
  options?: { force?: boolean },
) {
  return postJson<{
    segmentation_job: { id: string; document_id: string; status: string }
  }>(withForce('/api/segment', options?.force), { document_id: documentId })
}

export async function runCastDetection(
  documentId: string,
  options?: { force?: boolean; useLLM?: boolean },
) {
  return postJson<{
    cast_detection_job: { id: string; document_id: string; status: string }
  }>(withForce('/api/detect-cast', options?.force), { document_id: documentId, use_llm: options?.useLLM })
}

export async function runAttribution(
  documentId: string,
  options?: { force?: boolean },
) {
  return postJson<{
    attribution_job: { id: string; document_id: string; status: string }
  }>(withForce('/api/attribute', options?.force), { document_id: documentId })
}

function withForce(path: string, force = false) {
  return force ? `${path}?force=true` : path
}
