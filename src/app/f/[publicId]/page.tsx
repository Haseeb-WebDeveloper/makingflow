import type { Metadata } from "next";
import { getPublicForm } from "@/lib/data/public-form";
import { FormRenderer } from "@/components/forms/form-renderer";
import { Lottie } from "@/components/builder/lottie";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const res = await getPublicForm(publicId);
  return { title: res.state === "ok" ? res.form.title : "Form · MakingFlow" };
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
      <h1 className="font-sebenta text-3xl font-bold tracking-tight text-foreground">
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
