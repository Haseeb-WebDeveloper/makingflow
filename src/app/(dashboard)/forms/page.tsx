import type { Metadata } from "next"
import Link from "next/link"
import { getWorkspaceForms } from "@/lib/data/forms"
import { PageContainer, PageHeader, EmptyState } from "@/components/dashboard/page-shell"

export const metadata: Metadata = { title: "Forms · MakingFlow" }

export default async function FormsPage() {
  const forms = await getWorkspaceForms()

  return (
    <PageContainer>
      <PageHeader
        title="Forms"
        description="Build and manage your forms."
        action={
          <Link
            href="/forms/new"
            className="inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            New form
          </Link>
        }
      />

      {forms.length === 0 ? (
        <EmptyState
          icon="document"
          title="No forms yet"
          description="Describe a form in plain language and MakingFlow will build it for you."
          action={
            <Link
              href="/forms/new"
              className="inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              Build with AI
            </Link>
          }
        />
      ) : (
        <ul className="mt-8 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {forms.map((f) => (
            <li key={f.id}>
              <Link
                href={`/forms/${f.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{f.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Updated {formatDate(f.updatedAt)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs capitalize text-muted-foreground">
                  {f.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  )
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}
