import type { Metadata } from "next";
import { getPublicForm } from "@/lib/data/public-form";
import { FormRenderer } from "@/components/forms/form-renderer";
import { Lottie } from "@/components/builder/lottie";

/**
 * `submitForm` is a Server Action, and a Server Action runs as a POST to the
 * page that hosts it — so this page's budget is the submit path's budget.
 *
 * It has to cover the `after()` work, not just the insert: Sheets, Notion, a
 * webhook (5s timeout plus one retry), email, Discord, and then the AI
 * summary/screening sequentially after those. The platform default (10-15s)
 * cuts that off partway, and because `after()` runs post-response the casualty
 * is silent — the respondent sees success, the row is in the inbox, and the
 * Sheets row simply never appears with nothing logged. The integration code is
 * already written against a 60s budget (see MAX_FORM_BACKFILL in notion-sync),
 * which every dashboard route grants and this one did not.
 */
export const maxDuration = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const res = await getPublicForm(publicId);
  // Forms are shared by link to a specific audience — keep them out of search.
  const robots = { index: false } as const;
  if (res.state !== "ok") return { title: "Form · MakingFlow", robots };

  const title = res.form.title || "Untitled form";
  const description = `Fill out “${title}”. It only takes a minute.`;
  const url = `/f/${publicId}`;
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
  };
}

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const res = await getPublicForm(publicId);

  if (res.state !== "ok") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
        <NotAvailable missing={res.state === "missing"} />
      </div>
    );
  }

  // Top-aligned, full-width max-w-2xl column. The form/chat owns its own vertical
  // rhythm (the conversational runtime fixes its input to the screen bottom), so
  // the wrapper must NOT center — otherwise content floats to the middle and
  // shrinks to fit-content as it streams.
  return (
    <div key={publicId} className="min-h-dvh bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <FormRenderer form={res.form} />
      </div>
    </div>
  );
}

function NotAvailable({ missing }: { missing: boolean }) {
  return (
    <div className="rounded-lg bg-background p-10 text-center flex flex-col items-center justify-center">
      <Lottie name="not-available" className="size-40" />
      <h1 className="text-3xl font-bold tracking-tight text-foreground">
        {missing ? "Form not found" : "This form isn't available"}
      </h1>
      <p className="mt-1.5 text-muted-foreground">
        {missing
          ? "Double-check the link with whoever shared it."
          : "It may be unpublished or closed."}
      </p>
    </div>
  );
}
