"use client"

import * as React from "react"
import { useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Image from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import TextAlign from "@tiptap/extension-text-align"
import { markdownToHtml, htmlToMarkdown, toEditorHtml, preserveSpacing } from "@/lib/markdown"

export type RichTextEditorHandle = {
  /**
   * Insert an image at the current selection. `icon` inserts it as a small
   * inline image (tagged via the markdown title `"icon"`) so several can sit
   * side by side on one line; otherwise it's a full-width block image.
   */
  insertImage: (src: string, opts?: { icon?: boolean }) => void
  focus: () => void
}

type RichTextEditorProps = {
  /** Initial content (read once on mount; editor owns it after). */
  value: string
  /** Fires on every edit with the content serialized back out (format per `mode`). */
  onChange: (value: string) => void
  placeholder?: string
  /** Extra controls rendered at the end of the toolbar (e.g. image/video upload). */
  toolbarExtras?: React.ReactNode
  /**
   * Storage format. "html" keeps full fidelity (text alignment, exact spacing) and
   * is what the success page uses; "markdown" round-trips through markdown (lossy
   * for alignment). Defaults to "markdown".
   */
  mode?: "markdown" | "html"
}

/**
 * Notion-style WYSIWYG editor (Tiptap) used in the builder. Content rides in and
 * out as markdown so storage + the public runtime stay markdown-only — see
 * `@/lib/markdown`. Underline/strike are disabled because markdown can't express
 * them, keeping the round-trip lossless.
 */
export const RichTextEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor({ value, onChange, placeholder, toolbarExtras, mode = "markdown" }, ref) {
    const html = mode === "html"
    // Always call the latest onChange — Tiptap captures onUpdate at creation, so
    // a ref keeps it from going stale and clobbering sibling state (title/video).
    const onChangeRef = React.useRef(onChange)
    React.useEffect(() => {
      onChangeRef.current = onChange
    })

    const editor = useEditor({
      immediatelyRender: false, // Next SSR: build the editor on the client only
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          underline: false,
          strike: false,
          link: {
            openOnClick: false,
            HTMLAttributes: { rel: "noreferrer noopener", target: "_blank" },
          },
        }),
        // inline:true lets icon-sized images flow next to each other on one
        // line (a row of social icons) instead of each taking a full block.
        Image.configure({ allowBase64: false, inline: true }),
        Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
        // Text alignment can't be expressed in markdown, so it's only meaningful
        // (and persisted) in html mode.
        ...(html ? [TextAlign.configure({ types: ["heading", "paragraph"] })] : []),
      ],
      content: html ? toEditorHtml(value) : markdownToHtml(value),
      editorProps: {
        attributes: { class: "ProseMirror tiptap-body", "aria-label": "Rich text editor" },
      },
      onUpdate: ({ editor }) =>
        onChangeRef.current(html ? preserveSpacing(editor.getHTML()) : htmlToMarkdown(editor.getHTML())),
    })

    React.useImperativeHandle(
      ref,
      () => ({
        insertImage: (src: string, opts?: { icon?: boolean }) =>
          editor
            ?.chain()
            .focus()
            .setImage({ src, title: opts?.icon ? "icon" : undefined })
            .run(),
        focus: () => editor?.chain().focus().run(),
      }),
      [editor],
    )

    return (
      <div className="tiptap-editor rounded-md border border-input bg-input/30 focus-within:border-foreground/40">
        <Toolbar editor={editor} align={html}>{toolbarExtras}</Toolbar>
        <EditorContent
          editor={editor}
          className="thin-scroll max-h-[420px] overflow-y-auto px-3 py-2.5 text-sm text-foreground"
        />
      </div>
    )
  },
)

function Toolbar({
  editor,
  align,
  children,
}: {
  editor: Editor | null
  align?: boolean
  children?: React.ReactNode
}) {
  const state = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor?.isActive("bold") ?? false,
      italic: ctx.editor?.isActive("italic") ?? false,
      h1: ctx.editor?.isActive("heading", { level: 1 }) ?? false,
      h2: ctx.editor?.isActive("heading", { level: 2 }) ?? false,
      h3: ctx.editor?.isActive("heading", { level: 3 }) ?? false,
      bullet: ctx.editor?.isActive("bulletList") ?? false,
      ordered: ctx.editor?.isActive("orderedList") ?? false,
      quote: ctx.editor?.isActive("blockquote") ?? false,
      link: ctx.editor?.isActive("link") ?? false,
      alignLeft: ctx.editor?.isActive({ textAlign: "left" }) ?? false,
      alignCenter: ctx.editor?.isActive({ textAlign: "center" }) ?? false,
      alignRight: ctx.editor?.isActive({ textAlign: "right" }) ?? false,
    }),
  })

  function setLink() {
    if (!editor) return
    const prev = editor.getAttributes("link").href as string | undefined
    const url = window.prompt("Link URL", prev ?? "https://")
    if (url === null) return // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
  }

  const disabled = !editor

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      <Btn label="B" title="Bold" className="font-bold" active={state?.bold} disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()} />
      <Btn label="I" title="Italic" className="italic" active={state?.italic} disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()} />
      <Sep />
      <Btn label="H1" title="Heading 1" active={state?.h1} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
      <Btn label="H2" title="Heading 2" active={state?.h2} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
      <Btn label="H3" title="Heading 3" active={state?.h3} disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
      <Sep />
      <Btn label="•" title="Bullet list" active={state?.bullet} disabled={disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
      <Btn label="1." title="Numbered list" active={state?.ordered} disabled={disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
      <Btn label="❝" title="Quote" active={state?.quote} disabled={disabled} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
      <Btn label="Link" title="Link" active={state?.link} disabled={disabled} onClick={setLink} />
      {align ? (
        <>
          <Sep />
          <Btn label="⯇" title="Align left" active={state?.alignLeft} disabled={disabled} onClick={() => editor?.chain().focus().setTextAlign("left").run()} />
          <Btn label="≡" title="Align center" active={state?.alignCenter} disabled={disabled} onClick={() => editor?.chain().focus().setTextAlign("center").run()} />
          <Btn label="⯈" title="Align right" active={state?.alignRight} disabled={disabled} onClick={() => editor?.chain().focus().setTextAlign("right").run()} />
        </>
      ) : null}
      {children ? (
        <>
          <Sep />
          {children}
        </>
      ) : null}
    </div>
  )
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
}

function Btn({
  label,
  title,
  onClick,
  active,
  disabled,
  className,
}: {
  label: string
  title: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-50 " +
        (active ? "bg-foreground text-background " : "text-foreground hover:bg-muted ") +
        (className ?? "")
      }
    >
      {label}
    </button>
  )
}
