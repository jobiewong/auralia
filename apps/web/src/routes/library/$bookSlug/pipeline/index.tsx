import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/$bookSlug/pipeline/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/library/$bookTitle/pipeline/"!</div>
}
