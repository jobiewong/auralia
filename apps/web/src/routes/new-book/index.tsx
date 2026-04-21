import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new-book/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/new-book/"!</div>
}
