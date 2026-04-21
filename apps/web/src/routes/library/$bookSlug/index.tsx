import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/$bookSlug/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/library/$bookTitle/page"!</div>
}
