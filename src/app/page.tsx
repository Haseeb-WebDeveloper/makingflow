import { getOptionalUser } from "@/lib/auth/session"
import { SiteHeader } from "@/components/landing-page/site-header"
import { Hero } from "@/components/landing-page/hero"
import { TrustLogos } from "@/components/landing-page/trust-logos"
import { AboutPlatform } from "@/components/landing-page/about-platform"
import { BuiltToFix } from "@/components/landing-page/built-to-fix"
import { ThreeSteps } from "@/components/landing-page/three-steps"
import { FeaturesGrid } from "@/components/landing-page/features-grid"
import { ConnectScale } from "@/components/landing-page/connect-scale"
import { Pricing } from "@/components/landing-page/pricing"
import { FinalCta } from "@/components/landing-page/final-cta"
import { SiteFooter } from "@/components/landing-page/site-footer"

export default async function Home() {
  const user = await getOptionalUser()
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader isAuthed={Boolean(user)} />
      <main>
        <Hero />
        <TrustLogos />
        <AboutPlatform />
        <BuiltToFix />
        <ThreeSteps />
        <FeaturesGrid />
        <ConnectScale />
        <Pricing />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}
