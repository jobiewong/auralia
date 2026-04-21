import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/$bookSlug/synthesis/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/library/$bookSlug/synthesis/"!</div>
}
