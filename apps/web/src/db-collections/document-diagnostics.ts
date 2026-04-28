import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { getDocumentDiagnostics } from '~/server/documents'

function documentDiagnosticsKey(bookSlug: string, documentId: string) {
  return ['document-diagnostics', bookSlug, documentId] as const
}

function hasActivePipelineJob(diagnostics: unknown) {
  if (!diagnostics || typeof diagnostics !== 'object') {
    return false
  }

  return [
    'latestIngestionJob',
    'latestSegmentationJob',
    'latestCastDetectionJob',
    'latestAttributionJob',
    'latestSynthesisJob',
  ].some((key) => {
    const job = (diagnostics as Record<string, unknown>)[key]
    return (
      job &&
      typeof job === 'object' &&
      ['pending', 'running'].includes(
        String((job as { status?: unknown }).status),
      )
    )
  })
}

export function preloadDocumentDiagnostics(
  queryClient: QueryClient,
  bookSlug: string,
  documentId: string,
) {
  return queryClient.ensureQueryData({
    queryKey: documentDiagnosticsKey(bookSlug, documentId),
    queryFn: () => getDocumentDiagnostics({ data: { bookSlug, documentId } }),
    staleTime: 5_000,
  })
}

export function useDocumentDiagnostics(bookSlug: string, documentId: string) {
  const { data: diagnostics, refetch } = useQuery({
    queryKey: documentDiagnosticsKey(bookSlug, documentId),
    queryFn: () => getDocumentDiagnostics({ data: { bookSlug, documentId } }),
    staleTime: 5_000,
    refetchInterval: (query) =>
      hasActivePipelineJob(query.state.data) ? 1_000 : false,
  })

  return { diagnostics, refetch }
}
