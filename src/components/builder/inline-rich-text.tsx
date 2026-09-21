"use client"

import * as React from "react"
import { Extension, useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { markdownToHtml, htmlToMarkdown } from "@/lib/markdown"
import { toInlineMarkdown } from "@/lib/markdown-inline"
import { cn } from "@/lib/utils"

type Variant = "heading" | "paragraph" | "question"

/**
 * Enter inserts a line break instead of splitting the block.
 *
 * Only for `question`, whose runtime renderer (INLINE_MD in field-control)
 * unwraps `<p>` to a fragment so the marks can sit directly inside the <label>.
 * A second paragraph would render with NOTHING between it and the first —
 * "Line oneLine two". A hard break survives the round-trip intact (turndown
 * writes "  \n", marked and remark both read it back as <br>) and matches what
 * the plain textarea this replaced already did with Enter.
 */
const EnterIsLineBreak = Extension.create({
  name: "enterIsLineBreak",
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.setHardBreak() }
  },
})

/**
 * Seamless, borderless inline editor for the builder's content blocks (heading +
 * paragraph) and question text. It looks just like plain text on the canvas; a
 * floating toolbar appears on selection (Notion-style) for formatting. Content
 * rides in and out as markdown so storage + the public runtime stay
 * markdown-only (see `@/lib/markdown`). `heading` and `question` allow only
 * inline marks (bold/italic/link) since lists/sub-headings make no sense in a
 * one-line title or a question; `paragraph` adds lists + quotes.
 * Underline/strike are off because markdown can't express them.
 */
export function InlineRichText({
  value,
  onChange,
  placeholder,
  className,
  variant,
}: {
  value: string
  onChange: (markdown: string) => void
  placeholder: string
  className?: string
  variant: Variant
}) {
  // Heading and question are single-line prose: lists/quotes are switched off
  // below, so a stored block construct would not survive the load — Tiptap
  // would parse "1. Full Name" as a list, drop the disabled list node, and
  // save back "Full Name". Normalizing on the way IN keeps the marker as text,
  // matching what the runtime renders.
  const load = React.useCallback(
    (v: string) => markdownToHtml(variant === "paragraph" ? v : toInlineMarkdown(v)),
    [variant],
  )

  // Tiptap captures onUpdate once at creation — a ref keeps the latest onChange
  // from going stale and clobbering sibling field state.
  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => {
    onChangeRef.current = onChange
  })
  // The last markdown we emitted, so an external `value` change (e.g. an AI edit
  // to this block) re-syncs the editor without fighting the user's own typing.
  const lastEmitted = React.useRef(value)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        underline: false,
        strike: false,
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: "noreferrer noopener", target: "_blank" },
        },
        ...(variant === "paragraph"
          ? {}
          : { bulletList: false, orderedList: false, listItem: false, blockquote: false }),
      }),
      Placeholder.configure({ placeholder }),
      ...(variant === "question" ? [EnterIsLineBreak] : []),
    ],
    content: load(value),
    editorProps: {
      // Typography lives on the wrapper (below) so it updates live when a block
      // toggles between heading sizes; the editable element just clears focus ring.
      attributes: { class: "inline-rich-text-body focus:outline-none" },
    },
    onUpdate: ({ editor }) => {
      const md = htmlToMarkdown(editor.getHTML())
      lastEmitted.current = md
      onChangeRef.current(md)
    },
  })

  // Re-sync when the value changes from outside (not from our own onUpdate).
  React.useEffect(() => {
    if (!editor) return
    if (value === lastEmitted.current) return
    if (htmlToMarkdown(editor.getHTML()) === value) {
      lastEmitted.current = value
      return
    }
    lastEmitted.current = value
    editor.commands.setContent(load(value), { emitUpdate: false })
  }, [value, editor, load])

  return (
    <div
      className={cn(
        "inline-rich-text",
        // Lets the stylesheet draw the bold mark at REGULAR weight here, to
        // match how the runtime renders a question (see QUESTION_MD).
        variant === "question" && "inline-rich-text--question",
        className,
      )}
    >
      {editor ? (
        <BubbleMenu editor={editor} options={{ placement: "top" }}>
          <Toolbar editor={editor} variant={variant} />
        </BubbleMenu>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  )
}

/**
 * What a typed address should become, or null to refuse it.
 *
 * Bare hosts get https:// so "example.com" behaves the way anyone typing it
 * expects. Any OTHER scheme is refused outright rather than passed through —
 * `javascript:` and `data:` in an owner-authored question would run for every
 * respondent. The public runtime sanitizes too, but the builder preview renders
 * the same markdown, so this must not rely on that alone.
 */
export function safeHref(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null
  if (v.startsWith("/") || v.startsWith("#")) return v
  return `https://${v}`
}

function Toolbar({ editor, variant }: { editor: Editor; variant: Variant }) {
  // The URL being typed, or null when the link form is closed. Lives here
  // rather than in a separate popover on purpose: the bubble menu's default
  // `shouldShow` treats focus INSIDE the menu as editor focus, so an input
  // rendered here keeps the menu open and the text selection intact.
  const [linkDraft, setLinkDraft] = React.useState<string | null>(null)
  const [rejected, setRejected] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  // The selection the form was opened for, so a selection change closes it.
  const openedFor = React.useRef<string | null>(null)

  const state = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor.isActive("bold"),
      italic: ctx.editor.isActive("italic"),
      link: ctx.editor.isActive("link"),
      bullet: ctx.editor.isActive("bulletList"),
      ordered: ctx.editor.isActive("orderedList"),
      range: `${ctx.editor.state.selection.from}:${ctx.editor.state.selection.to}`,
    }),
  })

  const open = linkDraft !== null

  React.useEffect(() => {
    if (open) inputRef.current?.select()
  }, [open])

  // The bubble menu is hidden, not unmounted, so without this the form would
  // still be open (with a stale URL) the next time it appears.
  React.useEffect(() => {
    if (open && openedFor.current !== null && openedFor.current !== state.range) {
      setLinkDraft(null)
      setRejected(false)
    }
  }, [open, state.range])

  function openLink() {
    openedFor.current = state.range
    setRejected(false)
    setLinkDraft((editor.getAttributes("link").href as string | undefined) ?? "")
  }

  function close() {
    setLinkDraft(null)
    setRejected(false)
    editor.chain().focus().run()
  }

  function applyLink() {
    const href = safeHref(linkDraft ?? "")
    if (!href) {
      // An empty box means "remove the link"; anything we refused is a mistake
      // worth showing rather than silently dropping.
      if ((linkDraft ?? "").trim()) {
        setRejected(true)
        return
      }
      removeLink()
      return
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
    setLinkDraft(null)
    setRejected(false)
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    setLinkDraft(null)
    setRejected(false)
  }

  if (open) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-popover p-1 shadow-md">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            inputMode="url"
            value={linkDraft ?? ""}
            aria-label="Link URL"
            aria-invalid={rejected}
            placeholder="Paste a link or type example.com"
            onChange={(e) => {
              setLinkDraft(e.target.value)
              setRejected(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") {
                e.preventDefault()
                applyLink()
              } else if (e.key === "Escape") {
                e.preventDefault()
                close()
              }
            }}
            className={
              "h-7 w-56 rounded-md border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring/60 " +
              (rejected ? "border-destructive" : "border-border")
            }
          />
          <Btn label="Apply" title="Apply link" onClick={applyLink} />
          {state.link ? <Btn label="Remove" title="Remove link" onClick={removeLink} /> : null}
          <Btn label="✕" title="Cancel" onClick={close} />
        </div>
        {rejected ? (
          <p role="alert" className="px-1 pb-0.5 text-[11px] text-destructive">
            Use a web address, email or phone link.
          </p>
        ) : null}
      </div>
    )
  }

  // In a question the surrounding text is already semibold, so "bold" has
  // nothing left to add — the mark reads as the opposite there and lightens the
  // selection instead (see QUESTION_MD in field-control). The button previews
  // that: its own glyph is drawn at the weight the selection will become.
  const boldLightens = variant === "question"

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md">
      <Btn
        label="B"
        title={boldLightens ? "Regular weight" : "Bold"}
        className={boldLightens ? "font-normal" : "font-bold"}
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <Btn label="I" title="Italic" className="italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Btn label="Link" title={state.link ? "Edit link" : "Link"} active={state.link} onClick={openLink} />
      {variant === "paragraph" ? (
        <>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Btn label="•" title="Bullet list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <Btn label="1." title="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        </>
      ) : null}
    </div>
  )
}

function Btn({
  label,
  title,
  onClick,
  active,
  className,
}: {
  label: string
  title: string
  onClick: () => void
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={
        "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors " +
        (active ? "bg-foreground text-background " : "text-foreground hover:bg-muted ") +
        (className ?? "")
      }
    >
      {label}
    </button>
  )
}
