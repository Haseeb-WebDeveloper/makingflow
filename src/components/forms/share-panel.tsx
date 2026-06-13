"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"
import { FormDomainPicker } from "@/components/forms/domain-picker"
import { setFormDomain } from "@/lib/actions/domains"
import { publishForm } from "@/lib/actions/forms"
import { showToast } from "@/components/ui/toast"

function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — no-op */
    }
  }
  return { copied, copy }
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const { copied, copy } = useCopy()
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      <Icon name={copied ? "tick-square" : "paper"} className="size-4" />
      {copied ? "Copied" : label}
    </button>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border py-6 first:pt-0 last:border-0">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="scrollbar-thin min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  )
}

/** Share + embed surface for a published form. */
export function SharePanel({
  url,
  published,
  formId,
  formTitle,
  domains,
  domainId,
  slug,
  domainHost,
}: {
  url: string
  published: boolean
  formId: string
  formTitle: string
  domains: { id: string; domain: string }[]
  domainId: string | null
  slug: string | null
  domainHost: string | null
}) {
  const router = useRouter()
  const [publishing, setPublishing] = useState(false)
  const standard = `<iframe src="${url}" width="100%" height="600" style="border:0" title="Form"></iframe>`
  const fullPage = url
  const popup = `<a href="${url}" target="_blank" rel="noopener">Open form</a>`

  async function handlePublish() {
    setPublishing(true)
    const res = await publishForm(formId)
    setPublishing(false)
    if (res.success) {
      showToast("Your form is live 🎉", { type: "success" })
      router.refresh()
    } else {
      showToast(res.error, { type: "error" })
    }
  }

  return (
    <div className="max-w-2xl">
      {!published ? (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-foreground/5 text-foreground">
            <Icon name="send" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">This form isn&apos;t published yet</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Publish it to make the link live and start collecting responses.
            </p>
          </div>
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
          >
            {publishing ? "Publishing…" : "Publish form"}
          </button>
        </div>
      ) : null}

      <Section title="Share link" description="Anyone with this link can fill out your form.">
        <div className="flex items-center gap-2">
          <div className="scrollbar-thin min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
            {url}
          </div>
          <CopyButton text={url} />
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
              "bg-foreground text-background hover:bg-foreground/90",
            )}
          >
            <Icon name="login" className="size-4" />
            Open
          </a>
        </div>
      </Section>

      <Section
        title="Embed on your site"
        description="Drop the form into any web page."
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground">Standard (inline)</p>
            <CodeBlock code={standard} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground">Full page</p>
            <CodeBlock code={fullPage} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground">Popup link</p>
            <CodeBlock code={popup} />
          </div>
        </div>
      </Section>

      <Section
        title="Custom domain"
        description="Serve this form from your own domain. Change or remove it anytime."
      >
        {domains.length > 0 ? (
          <FormDomainPicker
            domains={domains}
            domainId={domainId}
            slug={slug}
            domainHost={domainHost}
            formTitle={formTitle}
            onApply={(customDomainId, nextSlug) =>
              setFormDomain(formId, { customDomainId, slug: nextSlug })
            }
            onSuccess={() => router.refresh()}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No domains yet. Add one in{" "}
            <Link href="/domains" className="font-medium text-foreground hover:underline">
              Domains
            </Link>{" "}
            to publish this form on your own URL.
          </p>
        )}
      </Section>
    </div>
  )
}
