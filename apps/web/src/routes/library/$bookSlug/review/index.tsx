import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/$bookSlug/review/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/library/$bookSlug/review/"!</div>
}
