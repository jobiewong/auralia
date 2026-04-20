import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="rise-in relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14">
        <h1 className="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-black tracking-tight sm:text-6xl lg:text-8xl">
          Auralia
        </h1>
        <p className="mb-8 max-w-xl text-base sm:text-lg">
          Generate fully-voiced audiobooks from your own text or AO3
          publications using entirely local AI.
        </p>
      </section>
    </main>
  )
}
