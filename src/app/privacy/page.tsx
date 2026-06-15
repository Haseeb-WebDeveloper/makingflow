import type { Metadata } from "next"
import { getOptionalUser } from "@/lib/auth/session"
import { LegalShell } from "@/components/landing-page/legal-shell"

export const metadata: Metadata = {
  title: "Privacy Policy | MakingFlow",
  description: "How MakingFlow collects, uses, and protects personal data.",
}

export default async function PrivacyPage() {
  const user = await getOptionalUser()

  return (
    <LegalShell isAuthed={Boolean(user)} title="Privacy Policy" updated="June 15, 2026">
      <p>
        This Privacy Policy explains how MakingFlow, operated by Figmenta (“MakingFlow”, “we”,
        “us”), handles personal data. We are based in the European Union and aim to comply with the
        EU General Data Protection Regulation (GDPR).
      </p>

      <h2>1. Two roles: controller and processor</h2>
      <p>
        For data about <strong>account holders</strong> (the people who sign up and build forms),
        we are the <strong>data controller</strong>. For data submitted by{" "}
        <strong>respondents</strong> through a creator’s forms, the <strong>form creator is the
        controller</strong> and MakingFlow acts as a <strong>processor</strong> on their behalf.
        We process that data only to provide the service and on the creator’s instructions.
      </p>

      <h2>2. Data we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> your name, email address, and authentication details when
          you sign up (including via Google sign-in).
        </li>
        <li>
          <strong>Form and response data:</strong> the forms you build and the answers, files, and
          metadata respondents submit. This may include personal data you choose to collect (for
          example, names, contact details, or CVs).
        </li>
        <li>
          <strong>Usage data:</strong> limited technical and analytics data such as device type,
          approximate country, referrer, and event counts used to power your dashboards and to keep
          the service secure and reliable.
        </li>
        <li>
          <strong>Billing data:</strong> if you subscribe to a paid plan, billing details are
          handled by our payment provider; we do not store full card numbers.
        </li>
      </ul>

      <h2>3. How we use data</h2>
      <ul>
        <li>to provide, maintain, and secure the service and your account;</li>
        <li>to build, render, translate, and summarize forms and responses, including AI features;</li>
        <li>to deliver responses to the integrations you connect (such as Google Sheets or email);</li>
        <li>to show you analytics about your forms;</li>
        <li>to communicate with you about your account, security, and service updates;</li>
        <li>to comply with legal obligations and enforce our Terms.</li>
      </ul>

      <h2>4. AI processing</h2>
      <p>
        MakingFlow uses third-party AI models (currently Google’s Gemini models) to power form
        generation, conditional logic, multi-language support, and response summaries. Form
        definitions and, where you enable it, response content may be sent to the AI provider to
        produce these results. Build-time AI features operate on the form definition only, not on
        respondent answers. We do not use your content to train our own models, and we rely on the
        AI provider’s commitments regarding the handling of submitted data.
      </p>

      <h2>5. Legal bases (GDPR)</h2>
      <p>We process personal data under one or more of the following legal bases:</p>
      <ul>
        <li><strong>Contract:</strong> to provide the service you signed up for;</li>
        <li>
          <strong>Legitimate interests:</strong> to secure, maintain, and improve the service, where
          not overridden by your rights;
        </li>
        <li><strong>Consent:</strong> where required, for example for certain communications;</li>
        <li><strong>Legal obligation:</strong> to comply with applicable law.</li>
      </ul>
      <p>
        For respondent data, the lawful basis is determined by the form creator (the controller).
      </p>

      <h2>6. Sharing and sub-processors</h2>
      <p>
        We do not sell your personal data. We share data only with service providers
        (“sub-processors”) that help us run MakingFlow, under contracts that require them to protect
        it. These currently include:
      </p>
      <ul>
        <li><strong>Supabase:</strong> authentication and database hosting;</li>
        <li><strong>Vercel:</strong> application hosting and content delivery;</li>
        <li><strong>Google:</strong> AI processing (Gemini) and, if you connect it, Google Sheets;</li>
        <li><strong>Cloudinary:</strong> storage of uploaded files and images;</li>
        <li><strong>Resend:</strong> sending email notifications.</li>
      </ul>
      <p>We may also disclose data where required by law or to protect our rights and users.</p>

      <h2>7. International transfers</h2>
      <p>
        We aim to keep data within the European Union where practical. Where data is transferred
        outside the EU/EEA (for example to a sub-processor), we rely on appropriate safeguards such
        as the European Commission’s Standard Contractual Clauses.
      </p>

      <h2>8. Retention</h2>
      <p>
        We keep account data for as long as your account is active, and form and response data until
        you delete it or close your account. We may retain limited data for a reasonable period
        afterwards to comply with legal obligations, resolve disputes, and enforce our agreements,
        after which it is deleted or anonymized.
      </p>

      <h2>9. Your rights</h2>
      <p>
        Subject to applicable law, you have the right to access, correct, delete, or export your
        personal data, to restrict or object to certain processing, and to withdraw consent. You can
        manage and export much of your data directly in the app, or contact us to exercise these
        rights. You also have the right to lodge a complaint with your local data protection
        authority. If you are a respondent, please contact the form creator (the controller) first;
        we will assist them as their processor.
      </p>

      <h2>10. Security</h2>
      <p>
        We use technical and organizational measures to protect personal data, including encryption
        in transit, access controls, and tenant isolation so that data is never shared across
        workspaces. No system is perfectly secure, but we work to protect your data and to respond
        promptly to incidents.
      </p>

      <h2>11. Cookies</h2>
      <p>
        We use strictly necessary cookies to keep you signed in and to operate the service. We do
        not use third-party advertising cookies. Public forms set only the cookies needed to render
        and submit them.
      </p>

      <h2>12. Children</h2>
      <p>
        MakingFlow is not intended for children under 16, and we do not knowingly collect their
        personal data as account holders. Form creators are responsible for any data they collect
        from minors through their forms.
      </p>

      <h2>13. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. If we make material changes, we will
        provide reasonable notice. The “last updated” date above reflects the latest version.
      </p>

      <h2>14. Contact</h2>
      <p>
        For privacy questions or to exercise your rights, email us at{" "}
        <a href="mailto:privacy@makingflow.com">privacy@makingflow.com</a>.
      </p>
    </LegalShell>
  )
}
