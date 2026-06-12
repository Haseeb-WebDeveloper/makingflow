import { SiteHeader } from "@/components/landing-page/site-header"
import { Hero } from "@/components/landing-page/hero"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <Hero />
    </div>
  )
}
