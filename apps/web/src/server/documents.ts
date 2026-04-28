import { createServerFn } from '@tanstack/react-start'

import {
  CastCharacterInput,
  DeleteCastCharacterInput,
  DeleteDocumentInput,
  GetDocumentRouteTargetInput,
  ListDocumentSpansInput,
  ListWorkDocumentsInput,
  UpdateCastCharacterInput,
  UpdateDocumentTitleInput,
  UpdateSpanAttributionInput,
  addCastCharacterQuery,
  deleteCastCharacterQuery,
  deleteDocumentQuery,
  getDocumentDiagnosticsQuery,
  getDocumentRouteTargetQuery,
  listDocumentSpansQuery,
  listWorkDocumentsQuery,
  updateCastCharacterQuery,
  updateDocumentTitleQuery,
  updateSpanAttributionQuery,
} from '~/db/documents'

export const listWorkDocuments = createServerFn({ method: 'GET' })
  .inputValidator(ListWorkDocumentsInput)
  .handler(({ data }) => listWorkDocumentsQuery(data))

export const listDocumentSpans = createServerFn({ method: 'GET' })
  .inputValidator(ListDocumentSpansInput)
  .handler(({ data }) => listDocumentSpansQuery(data))

export const getDocumentRouteTarget = createServerFn({ method: 'GET' })
  .inputValidator(GetDocumentRouteTargetInput)
  .handler(({ data }) => getDocumentRouteTargetQuery(data))

export const getDocumentDiagnostics = createServerFn({ method: 'GET' })
  .inputValidator(ListDocumentSpansInput)
  .handler(({ data }) => getDocumentDiagnosticsQuery(data))

export const updateSpanAttribution = createServerFn({ method: 'POST' })
  .inputValidator(UpdateSpanAttributionInput)
  .handler(({ data }) => updateSpanAttributionQuery(data))

export const addCastCharacter = createServerFn({ method: 'POST' })
  .inputValidator(CastCharacterInput)
  .handler(({ data }) => addCastCharacterQuery(data))

export const updateCastCharacter = createServerFn({ method: 'POST' })
  .inputValidator(UpdateCastCharacterInput)
  .handler(({ data }) => updateCastCharacterQuery(data))

export const deleteCastCharacter = createServerFn({ method: 'POST' })
  .inputValidator(DeleteCastCharacterInput)
  .handler(({ data }) => deleteCastCharacterQuery(data))

export const updateDocumentTitle = createServerFn({ method: 'POST' })
  .inputValidator(UpdateDocumentTitleInput)
  .handler(({ data }) => updateDocumentTitleQuery(data))

export const deleteDocument = createServerFn({ method: 'POST' })
  .inputValidator(DeleteDocumentInput)
  .handler(({ data }) => deleteDocumentQuery(data))
