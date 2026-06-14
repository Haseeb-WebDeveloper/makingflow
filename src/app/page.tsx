import { getOptionalUser } from "@/lib/auth/session"
import { SiteHeader } from "@/components/landing-page/site-header"
import { Hero } from "@/components/landing-page/hero"
import { WhySection } from "@/components/landing-page/why-section"
import { HowItWorks } from "@/components/landing-page/how-it-works"
import { Intelligence } from "@/components/landing-page/intelligence"
import { FillModes } from "@/components/landing-page/fill-modes"
import { AnalyticsSection } from "@/components/landing-page/analytics-section"
import { AskAiSection } from "@/components/landing-page/ask-ai-section"
import { IntegrationsSection } from "@/components/landing-page/integrations-section"
import { UseCases } from "@/components/landing-page/use-cases"
import { ClosingCta } from "@/components/landing-page/closing-cta"
import { SiteFooter } from "@/components/landing-page/site-footer"

export default async function Home() {
  const user = await getOptionalUser()
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader isAuthed={Boolean(user)} />
      <main>
        <Hero />
        <WhySection />
        <HowItWorks />
        <Intelligence />
        <FillModes />
        <AnalyticsSection />
        <AskAiSection />
        <IntegrationsSection />
        <UseCases />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  )
}
