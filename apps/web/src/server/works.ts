import { createServerFn } from '@tanstack/react-start'

import {
  CreateWorkInput,
  DeleteWorkInput,
  UpdateWorkTitleInput,
  createWorkQuery,
  deleteWorkQuery,
  listWorksQuery,
  updateWorkTitleQuery,
} from '~/db/works'

export const listWorks = createServerFn({ method: 'GET' }).handler(listWorksQuery)

export const createWork = createServerFn({ method: 'POST' })
  .inputValidator(CreateWorkInput)
  .handler(({ data }) => createWorkQuery(data))

export const updateWorkTitle = createServerFn({ method: 'POST' })
  .inputValidator(UpdateWorkTitleInput)
  .handler(({ data }) => updateWorkTitleQuery(data))

export const deleteWork = createServerFn({ method: 'POST' })
  .inputValidator(DeleteWorkInput)
  .handler(({ data }) => deleteWorkQuery(data))
