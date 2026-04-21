import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/$bookSlug/voice-map/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/library/$bookSlug/voice-map/"!</div>
}
