import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/$bookSlug/cast/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/library/$bookSlug/cast/"!</div>
}
