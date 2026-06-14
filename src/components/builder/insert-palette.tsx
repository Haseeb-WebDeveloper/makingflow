"use client"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  FIELD_CATALOG,
  CATALOG_GROUP_ORDER,
  type CatalogGroup,
} from "@/lib/builder/form-model"
import type { AiFieldType } from "@/lib/ai/form-schema"
import type { FieldConfig } from "@/lib/db/schema"
import { FieldGlyph } from "@/components/builder/field-glyph"

const GROUP_LABEL: Record<CatalogGroup, string> = {
  Text: "Text",
  Choice: "Choice",
  Contact: "Contact",
  Rating: "Rating & scale",
  Date: "Date & time",
  File: "File",
  Layout: "Layout",
}

/** Tally-style "Insert anything" — searchable, categorized, keyboard-driven. */
export function InsertPalette({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (type: AiFieldType, config?: FieldConfig) => void
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Insert a block"
      description="Search questions, input fields, and layout blocks"
    >
      <CommandInput placeholder="Search questions, inputs, layout…" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>No blocks found.</CommandEmpty>
        {CATALOG_GROUP_ORDER.map((group) => {
          const items = FIELD_CATALOG.filter((c) => c.group === group)
          if (items.length === 0) return null
          return (
            <CommandGroup key={group} heading={GROUP_LABEL[group]}>
              {items.map((item) => (
                <CommandItem
                  key={item.label}
                  value={`${item.label} ${item.keywords ?? ""}`}
                  onSelect={() => {
                    onPick(item.type, item.config)
                    onOpenChange(false)
                  }}
                  className="gap-2.5 lg:gap-[0.694vw]"
                >
                  <FieldGlyph type={item.type} className="size-4 lg:size-[1.111vw] shrink-0 text-muted-foreground" />
                  <span className="text-sm lg:text-[0.972vw]">{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}
