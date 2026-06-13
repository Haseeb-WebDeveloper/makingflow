import type { AiFieldType } from "@/lib/ai/form-schema"

/** Small monochrome glyph per field type, for the canvas + insert palette. */
export function FieldGlyph({ type, className }: { type: AiFieldType; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths(type)}
    </svg>
  )
}

function paths(type: AiFieldType) {
  switch (type) {
    case "short_text":
      return <path d="M4 9h16M4 14h9" />
    case "long_text":
    case "paragraph":
      return <path d="M4 7h16M4 12h16M4 17h10" />
    case "multiple_choice":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </>
      )
    case "checkboxes":
    case "multi_select":
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 12l3 3 5-6" />
        </>
      )
    case "dropdown":
      return (
        <>
          <rect x="4" y="6" width="16" height="12" rx="2" />
          <path d="M9 11l3 3 3-3" />
        </>
      )
    case "yes_no":
      return (
        <>
          <rect x="3" y="8" width="18" height="8" rx="4" />
          <circle cx="8" cy="12" r="2.2" fill="currentColor" stroke="none" />
        </>
      )
    case "email":
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M4 7l8 6 8-6" />
        </>
      )
    case "phone":
      return <path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 005 5l1.5-2 4 1.5V18a2 2 0 01-2 2A15 15 0 014 6a2 2 0 012-2z" />
    case "url":
      return (
        <>
          <path d="M9.5 14.5l5-5" />
          <path d="M11 7l1-1a3.5 3.5 0 015 5l-1 1" />
          <path d="M13 17l-1 1a3.5 3.5 0 01-5-5l1-1" />
        </>
      )
    case "rating":
      return <path d="M12 4l2.2 4.5 5 .7-3.6 3.5.9 5L12 15.8 7.5 17.7l.9-5L4.8 9.2l5-.7L12 4z" />
    case "scale":
    case "nps":
      return (
        <>
          <path d="M4 12h16" />
          <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </>
      )
    case "date":
      return (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M4 9h16M8 3v4M16 3v4" />
        </>
      )
    case "time":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </>
      )
    case "file_upload":
      return (
        <>
          <path d="M12 16V5M8 9l4-4 4 4" />
          <path d="M5 19h14" />
        </>
      )
    case "heading":
      return <path d="M6 5v14M18 5v14M6 12h12" />
    case "page_break":
      return (
        <>
          <path d="M3 12h5M16 12h5" strokeDasharray="0.1 3" />
          <path d="M10 8l4 8" />
        </>
      )
    default:
      return <path d="M4 9h16M4 14h9" />
  }
}
