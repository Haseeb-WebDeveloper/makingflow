import type { Metadata } from "next"
import { getPublicForm } from "@/lib/data/public-form"
import { FormRenderer } from "@/components/forms/form-renderer"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>
}): Promise<Metadata> {
  const { publicId } = await params
  const res = await getPublicForm(publicId)
  return { title: res.state === "ok" ? res.form.title : "Form · MakingFlow" }
}

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ publicId: string }>
}) {
  const { publicId } = await params
  const res = await getPublicForm(publicId)

  return (
    <div className="min-h-dvh bg-canvas px-4 py-10 sm:py-16">
      <div key={publicId} className="mx-auto w-full max-w-2xl">
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
