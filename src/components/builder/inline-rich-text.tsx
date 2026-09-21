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
    <div className={cn("inline-rich-text", className)}>
      {editor ? (
        <BubbleMenu editor={editor} options={{ placement: "top" }}>
          <Toolbar editor={editor} variant={variant} />
        </BubbleMenu>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor, variant }: { editor: Editor; variant: Variant }) {
  const state = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor.isActive("bold"),
      italic: ctx.editor.isActive("italic"),
      link: ctx.editor.isActive("link"),
      bullet: ctx.editor.isActive("bulletList"),
      ordered: ctx.editor.isActive("orderedList"),
    }),
  })

  function setLink() {
    const prev = editor.getAttributes("link").href as string | undefined
    const url = window.prompt("Link URL", prev ?? "https://")
    if (url === null) return // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md">
      <Btn label="B" title="Bold" className="font-bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Btn label="I" title="Italic" className="italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Btn label="Link" title="Link" active={state.link} onClick={setLink} />
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
