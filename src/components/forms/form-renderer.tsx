import type { PublicForm } from "@/lib/data/public-form"
import { FormRuntime } from "@/components/forms/form-runtime"
import { ConversationalRuntime } from "@/components/forms/conversational-runtime"

/**
 * Picks the respondent front-end for a published form: the adaptive chat when
 * the form is conversational AND has AI enabled, otherwise the classic runtime.
 * Both read the same `PublicForm` spec and save to the same tables — only the
 * presentation differs. Shared by the /f/[publicId] and custom-domain routes.
 */
export function FormRenderer({ form }: { form: PublicForm }) {
  if (form.renderMode === "conversational" && form.ai?.enabled) {
    return <ConversationalRuntime form={form} />
  }
  return <FormRuntime form={form} />
}
