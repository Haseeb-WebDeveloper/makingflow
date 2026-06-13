import type { Metadata } from "next"
import { FormBuilder } from "@/components/builder/form-builder"

export const metadata: Metadata = { title: "New form · MakingFlow" }

export default function NewFormPage() {
  return <FormBuilder />
}
