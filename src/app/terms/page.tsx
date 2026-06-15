import type { Metadata } from "next"
import { getOptionalUser } from "@/lib/auth/session"
import { LegalShell } from "@/components/landing-page/legal-shell"

export const metadata: Metadata = {
  title: "Terms of Service | MakingFlow",
  description: "The terms that govern your use of MakingFlow.",
}

export default async function TermsPage() {
  const user = await getOptionalUser()

  return (
    <LegalShell isAuthed={Boolean(user)} title="Terms of Service" updated="June 15, 2026">
      <p>
        These Terms of Service (the “Terms”) govern your access to and use of MakingFlow, an
        AI form builder operated by Figmenta (“MakingFlow”, “we”, “us”, or “our”). By creating
        an account or using the service, you agree to these Terms. If you do not agree, do not
        use MakingFlow.
      </p>

      <h2>1. The service</h2>
      <p>
        MakingFlow lets you build, publish, and manage forms, collect responses, and use
        AI-assisted features to generate forms, adapt them to respondents, translate them, and
        summarize answers. We may add, change, or remove features over time.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You must be at least 16 years old and able to enter into a binding contract to use
        MakingFlow. You are responsible for the accuracy of your account information, for keeping
        your credentials secure, and for all activity that happens under your account. Notify us
        promptly of any unauthorized use.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to use MakingFlow to:</p>
      <ul>
        <li>break the law, or collect information in violation of any applicable law or regulation;</li>
        <li>
          collect personal data without a lawful basis or the necessary consent from respondents,
          or for purposes you have not disclosed to them;
        </li>
        <li>send spam, phish, harvest credentials, or deceive the people filling out your forms;</li>
        <li>
          upload or distribute malware, or attempt to gain unauthorized access to the service,
          other accounts, or our infrastructure;
        </li>
        <li>
          infringe intellectual property or privacy rights, or post unlawful, harassing, or
          abusive content;
        </li>
        <li>
          abuse, reverse-engineer, or place an unreasonable load on the service or its AI
          features, including automated scraping or resale of the service.
        </li>
      </ul>
      <p>
        You are solely responsible for the forms you create, the questions you ask, and how you
        use the responses you collect.
      </p>

      <h2>4. Your content and responsibilities</h2>
      <p>
        You retain all ownership of the forms, content, and response data you create or collect
        through MakingFlow (“Your Content”). You grant us a limited, non-exclusive license to
        host, store, process, and transmit Your Content solely to operate and improve the service
        and to provide it to you.
      </p>
      <p>
        Where Your Content includes personal data about respondents, <strong>you are the data
        controller</strong> and we act as your <strong>data processor</strong>. You are
        responsible for having a lawful basis to collect that data, for providing respondents with
        any required notices, and for honoring their rights. Our handling of personal data is
        described in our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>5. AI features</h2>
      <p>
        MakingFlow uses third-party AI models to help generate and adapt forms, translate content,
        and summarize responses. AI output can be inaccurate, incomplete, or unexpected, so you are
        responsible for reviewing it before relying on it. AI features are provided on a best-effort
        basis and may be unavailable at times; a form will still render, accept, and store
        responses as a standard form if the AI layer is unavailable.
      </p>

      <h2>6. Plans, billing, and free tier</h2>
      <p>
        MakingFlow offers a free tier and paid plans with usage limits (for example, on forms,
        monthly responses, AI usage, and file storage). Paid plans are billed in advance on a
        recurring basis and are non-refundable except where required by law. We may change pricing
        or plan limits on reasonable notice. You can cancel at any time; access continues until the
        end of the current billing period.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        MakingFlow integrates with third-party services you choose to connect (such as Google
        Sheets, webhooks, and email delivery). Your use of those services is governed by their own
        terms, and we are not responsible for them. Granting an integration access is your decision
        and your responsibility.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        MakingFlow, including its software, design, and branding, is owned by Figmenta and protected
        by intellectual property laws. These Terms do not grant you any right to our trademarks or
        to copy, modify, or create derivative works from the service.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may stop using MakingFlow and delete your account at any time. We may suspend or
        terminate your access if you breach these Terms, create risk or legal exposure for us, or
        for prolonged inactivity. On termination, your right to use the service ends; we may delete
        Your Content after a reasonable period, subject to the Privacy Policy and applicable law.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        The service is provided “as is” and “as available,” without warranties of any kind, whether
        express or implied, including fitness for a particular purpose and non-infringement. We do
        not warrant that the service will be uninterrupted, error-free, or secure, or that AI
        output will be accurate.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, MakingFlow and Figmenta will not be liable for any
        indirect, incidental, special, consequential, or punitive damages, or for any loss of data,
        revenue, or profits. Our total liability for any claim relating to the service is limited to
        the amount you paid us in the twelve months before the event giving rise to the claim.
        Nothing in these Terms limits liability that cannot be limited under applicable law.
      </p>

      <h2>12. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material changes, we will provide
        reasonable notice (for example, by email or an in-product notice). Your continued use of the
        service after the changes take effect means you accept the updated Terms.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These Terms are governed by the laws of Italy, without regard to conflict-of-law rules, and
        the courts of Italy will have jurisdiction, except where mandatory consumer-protection law
        provides otherwise.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms? Email us at{" "}
        <a href="mailto:legal@makingflow.com">legal@makingflow.com</a>.
      </p>
    </LegalShell>
  )
}
