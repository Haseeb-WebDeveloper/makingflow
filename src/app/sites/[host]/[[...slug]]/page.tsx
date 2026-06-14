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
  if (!formSlug) return { title: "Forms" }
  const res = await getPublicFormByDomain(host, formSlug)
  return { title: res.state === "ok" ? res.form.title : "Form" }
}

export default async function CustomDomainFormPage({ params }: { params: Params }) {
  const { host, slug } = await params
  const formSlug = slug?.[0]
  const res = formSlug
    ? await getPublicFormByDomain(host, formSlug)
    : ({ state: "missing" } as const)

  return (
    <div className="min-h-dvh bg-canvas px-4 py-10 sm:py-16">
      <div
        key={res.state === "ok" ? res.form.publicId : "unavailable"}
        className="mx-auto w-full max-w-2xl"
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
    <div className="rounded-xl border border-border bg-background p-10 text-center">
      <h1 className="font-sebenta text-xl font-bold tracking-tight text-foreground">
        {missing ? "Form not found" : "This form isn't available"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {missing
          ? "Double-check the link with whoever shared it."
          : "It may be unpublished or closed."}
      </p>
    </div>
  )
}
