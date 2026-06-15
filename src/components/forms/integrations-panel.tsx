"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { showToast } from "@/components/ui/toast";
import { WebhooksCard } from "@/components/forms/webhooks-card";
import { EmailCard } from "@/components/forms/email-card";
import { DiscordCard } from "@/components/forms/discord-card";
import { SyncIntegrationCard } from "@/components/forms/sync-integration-card";
import type {
  GoogleSheetsState,
  FormWebhook,
  FormEmailState,
  FormDiscordState,
  NotionState,
} from "@/lib/data/integrations";

export function IntegrationsPanel({
  formId,
  state,
  webhooks,
  email,
  discord,
  notion,
  ownerEmail,
}: {
  formId: string;
  state: GoogleSheetsState;
  webhooks: FormWebhook[];
  email: FormEmailState;
  discord: FormDiscordState;
  notion: NotionState;
  ownerEmail: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Surface the OAuth round-trip result once, then strip the query param.
  React.useEffect(() => {
    const google = searchParams.get("google");
    const notionStatus = searchParams.get("notion");
    if (!google && !notionStatus) return;

    const provider = google ? "Google" : "Notion";
    const status = google ?? notionStatus;
    if (status === "connected") {
      showToast(
        google
          ? "Google connected, all forms now sync to Sheets"
          : "Notion connected, all forms now sync to Notion",
        { type: "success" }
      );
    } else if (status === "error") {
      const reason = searchParams.get("reason");
      showToast(`Couldn't connect ${provider}`, {
        type: "error",
        description:
          reason === "denied" ? "Access was declined." : "Please try again.",
      });
    }
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {/* ── Google Sheets ── */}
      <SyncIntegrationCard
        formId={formId}
        provider="google"
        configured={state.configured}
        connectionLabel={
          state.connection ? `Connected as ${state.connection.accountEmail}` : null
        }
        status={state.status}
        destinationUrl={state.spreadsheetUrl}
      />

      {/* ── Webhooks ── */}
      <WebhooksCard formId={formId} webhooks={webhooks} />

      {/* ── Email notifications ── */}
      <EmailCard formId={formId} state={email} ownerEmail={ownerEmail} />

      {/* ── Discord ── */}
      <DiscordCard formId={formId} state={discord} />

      {/* ── Notion ── */}
      <SyncIntegrationCard
        formId={formId}
        provider="notion"
        configured={notion.configured}
        connectionLabel={
          notion.connection ? `Connected to ${notion.connection.workspaceName}` : null
        }
        status={notion.status}
        destinationUrl={notion.databaseUrl}
      />
    </div>
  );
}
