import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/$bookSlug/text/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/library/$bookSlug/text/"!</div>
}
