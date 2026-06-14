import type { Metadata } from "next"
import { getPublicFormByDomain } from "@/lib/data/public-form"
import { FormRenderer } from "@/components/forms/form-renderer"

/**
 * Custom-domain form runtime. `proxy.ts` rewrites requests on an attached
 * domain (team.acme.com/feedback) to this route as /sites/team.acme.com/feedback,
 * so [host] is the domain and the first [[...slug]] segment is the form slug.
 * Reuses the exact same FormRuntime + resolution as /f/[publicId].
 */

type Params = Promise<{ host: string; slug?: string[] }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { host, slug } = await params
  const formSlug = slug?.[0]
  const robots = { index: false } as const
  if (!formSlug) return { title: "Forms", robots }

  const res = await getPublicFormByDomain(host, formSlug)
  if (res.state !== "ok") return { title: "Form", robots }

  const title = res.form.title || "Untitled form"
  const description = `Fill out “${title}” — it only takes a minute.`
  // Absolute URL on the custom domain (metadataBase points at the main site).
  const url = `https://${host}/${formSlug}`
  return {
    title,
    description,
    robots,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      images: [{ url: "/og.png", width: 1080, height: 607 }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  }
}

export default async function CustomDomainFormPage({ params }: { params: Params }) {
  const { host, slug } = await params
  const formSlug = slug?.[0]
  const res = formSlug
    ? await getPublicFormByDomain(host, formSlug)
    : ({ state: "missing" } as const)

  return (
    <div className="min-h-dvh bg-canvas px-4 lg:px-[1.111vw] py-10 lg:py-[2.778vw] sm:py-16">
      <div
        key={res.state === "ok" ? res.form.publicId : "unavailable"}
        className="mx-auto w-full max-w-2xl lg:max-w-[46.667vw]"
      >
        {res.state === "ok" ? (
          <FormRenderer form={res.form} />
        ) : (
          <NotAvailable missing={res.state === "missing"} />
        )}
      </div>
    </div>
  )
}

function NotAvailable({ missing }: { missing: boolean }) {
  return (
    <div className="rounded-xl lg:rounded-[0.926vw] border border-border bg-background p-10 lg:p-[2.778vw] text-center">
      <h1 className="font-sebenta text-xl lg:text-[1.389vw] font-bold tracking-tight text-foreground">
        {missing ? "Form not found" : "This form isn't available"}
      </h1>
      <p className="mt-2 lg:mt-[0.556vw] text-sm lg:text-[0.972vw] text-muted-foreground">
        {missing
          ? "Double-check the link with whoever shared it."
          : "It may be unpublished or closed."}
      </p>
    </div>
  )
}
