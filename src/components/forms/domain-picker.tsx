"use client"

import { useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { showToast } from "@/components/ui/toast"
import { slugify } from "@/lib/forms/share"

const DEFAULT = "__default"

export type SetDomainResult = {
  success: boolean
  error?: string
  domain?: string | null
  slug?: string | null
}

/**
 * Reusable control to attach a form to a custom domain at a slug, change which
 * domain/path it uses, or revert to the default link. Used in the publish
 * dialog and the Share tab so the link is editable from either place.
 *
 * Persistence is the caller's concern via `onApply` — that lets the builder
 * save-then-attach while the Share tab calls the action directly.
 */
export function FormDomainPicker({
  domains,
  domainId,
  slug,
  domainHost,
  formTitle,
  onApply,
  onSuccess,
}: {
  domains: { id: string; domain: string }[]
  domainId: string | null
  slug: string | null
  domainHost: string | null
  formTitle: string
  onApply: (customDomainId: string | null, slug: string | null) => Promise<SetDomainResult>
  onSuccess?: () => void
}) {
  const [selId, setSelId] = useState<string>(domainId ?? "")
  const [slugDraft, setSlugDraft] = useState<string>(slug ?? slugify(formTitle))
  const [applying, setApplying] = useState(false)

  const selectedDomain = domains.find((d) => d.id === selId)
  const dirty = selId !== (domainId ?? "") || slugify(slugDraft) !== (slug ?? "")
  const attached = Boolean(domainHost && slug)

  async function apply(nextId: string | null, nextSlug: string | null) {
    setApplying(true)
    const res = await onApply(nextId, nextSlug)
    setApplying(false)
    if (res.success) {
      showToast(nextId ? "Custom domain updated" : "Reverted to the default link", {
        type: "success",
      })
      onSuccess?.()
    } else {
      showToast(res.error ?? "Couldn't update the domain", { type: "error" })
    }
  }

  function onSelect(value: string) {
    if (value === DEFAULT) {
      setSelId("")
      void apply(null, null)
      return
    }
    setSelId(value)
    if (!slugDraft) setSlugDraft(slugify(formTitle))
  }

  return (
    <div className="space-y-2.5 lg:space-y-[0.694vw]">
      <Select value={selId || DEFAULT} onValueChange={onSelect}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Default link" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>Default link (makingflow.com/f/…)</SelectItem>
          {domains.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.domain}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedDomain ? (
        <>
          <div className="flex items-center gap-0 rounded-md lg:rounded-[0.556vw] border border-border bg-background focus-within:border-ring">
            <span className="shrink-0 truncate border-r border-border px-2.5 lg:px-[0.694vw] py-2 lg:py-[0.556vw] font-mono text-xs lg:text-[0.833vw] text-muted-foreground">
              {selectedDomain.domain}/
            </span>
            <input
              value={slugDraft}
              onChange={(e) => setSlugDraft(e.target.value)}
              placeholder="feedback"
              spellCheck={false}
              autoCapitalize="off"
              className="min-w-0 flex-1 bg-transparent px-2.5 lg:px-[0.694vw] py-2 lg:py-[0.556vw] font-mono text-xs lg:text-[0.833vw] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <Button
              size="sm"
              disabled={applying || !slugify(slugDraft) || !dirty}
              onClick={() => apply(selId, slugDraft)}
              className="m-1 lg:m-[0.278vw] shrink-0"
            >
              {applying ? "Saving…" : "Apply"}
            </Button>
          </div>
          <p className="text-xs lg:text-[0.833vw] text-muted-foreground">
            Live at{" "}
            <span className="font-mono text-foreground">
              {selectedDomain.domain}/{slugify(slugDraft) || "…"}
            </span>
          </p>
        </>
      ) : attached ? (
        <p className="text-xs lg:text-[0.833vw] text-muted-foreground">
          Currently{" "}
          <span className="font-mono text-foreground">
            {domainHost}/{slug}
          </span>
        </p>
      ) : null}
    </div>
  )
}
