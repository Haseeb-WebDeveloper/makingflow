"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import {
  FormSettings,
  type FormSettingsHandle,
} from "@/components/forms/form-settings";
import {
  FormDomainPicker,
  type SetDomainResult,
} from "@/components/forms/domain-picker";
import { FormFolderPicker } from "@/components/forms/folder-picker";
import type { FormSettingsData } from "@/lib/data/forms";
import type { WorkspaceFolder } from "@/lib/data/folders";
import { SVGIcon } from "../ui/svg-icon";

export function PublishDialog({
  open,
  onOpenChange,
  published,
  publishing,
  shareUrl,
  formId,
  formTitle,
  domains,
  domainId,
  slug,
  domainHost,
  onSetDomain,
  folders,
  settings,
  formStatus,
  onPublish,
  onUnpublish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  published: boolean;
  publishing: boolean;
  shareUrl: string;
  formId: string | null;
  formTitle?: string;
  domains?: { id: string; domain: string }[];
  domainId?: string | null;
  slug?: string | null;
  domainHost?: string | null;
  onSetDomain?: (
    customDomainId: string | null,
    slug: string | null
  ) => Promise<SetDomainResult>;
  folders?: WorkspaceFolder[];
  settings?: FormSettingsData | null;
  formStatus?: string;
  onPublish: () => void;
  onUnpublish: () => void;
}) {
  const settingsRef = useRef<FormSettingsHandle>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] overflow-y-auto w-fit thin-scroll ">
        <DialogHeader>
          {published ? (
            <>
              <DialogTitle className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-success" />
                Your form is live
              </DialogTitle>
              <DialogDescription>
                Share this link to start collecting responses.
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle>Publish your form</DialogTitle>
              <DialogDescription>
                Publishing makes your form live at a public link. Anyone with
                the link can respond, and you can unpublish any time.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {published ? (
          <ShareLink
            shareUrl={shareUrl}
            formId={formId}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <ul className="space-y-2.5 py-1 text-sm text-muted-foreground">
            <InfoRow icon="discovery">Get a shareable public link</InfoRow>
            <InfoRow icon="folder">
              Start collecting responses instantly
            </InfoRow>
            <InfoRow icon="edit">Edits you make go live automatically</InfoRow>
          </ul>
        )}

        {formId && folders ? (
          <section className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Folder</h3>
            <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
              Organize this form into a folder, or leave it uncategorized.
            </p>
            <FormFolderPicker
              formId={formId}
              folders={folders}
              currentFolderId={settings?.folderId ?? null}
            />
          </section>
        ) : null}

        {domains && domains.length > 0 && onSetDomain ? (
          <section className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              Custom domain
            </h3>
            <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
              Serve this form from one of your connected domains, and change or
              remove it anytime.
            </p>
            <FormDomainPicker
              domains={domains}
              domainId={domainId ?? null}
              slug={slug ?? null}
              domainHost={domainHost ?? null}
              formTitle={formTitle ?? ""}
              onApply={onSetDomain}
            />
          </section>
        ) : null}

        {formId && settings ? (
          <section className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              Form settings
            </h3>
            <FormSettings
              key={formStatus}
              ref={settingsRef}
              formId={formId}
              initial={{ ...settings, status: formStatus ?? settings.status }}
              embedded
              onDirtyChange={setSettingsDirty}
              onSavingChange={setSettingsSaving}
            />
          </section>
        ) : null}

        <DialogFooter className="sticky -bottom-6 z-10 -mx-6 -mb-6 mt-0 items-center gap-2 border-t border-border bg-popover px-6 pt-4 pb-6 sm:justify-between lg:-bottom-[24px] lg:-mx-[24px] lg:-mb-[24px] lg:px-[24px] lg:pt-[16px] lg:pb-[24px]">
          {published ? (
            <>
              <Button
                variant="destructive"
                onClick={() => setConfirmUnpublish(true)}
                className="h-9 px-4"
              >
                Unpublish
              </Button>
              <div className="flex items-center gap-2">
                {settingsDirty ? (
                  <Button
                    onClick={() => void settingsRef.current?.save()}
                    disabled={settingsSaving}
                    className="h-9 px-4"
                  >
                    {settingsSaving ? "Saving…" : "Save changes"}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="h-9 px-4"
                >
                  Done
                </Button>
              </div>
            </>
          ) : (
            <div className="flex w-full items-center gap-2">
              {settingsDirty ? (
                <Button
                  variant="outline"
                  onClick={() => void settingsRef.current?.save()}
                  disabled={settingsSaving}
                  className="shrink-0 h-9 px-4"
                >
                  {settingsSaving ? "Saving…" : "Save changes"}
                </Button>
              ) : null}
              <Button
                onClick={onPublish}
                disabled={publishing}
                className="flex-1 h-10 px-4"
              >
                {publishing ? "Publishing…" : "Publish form"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish this form?</AlertDialogTitle>
            <AlertDialogDescription>
              The public link will stop working immediately and visitors
              won&apos;t be able to respond. Existing submissions are kept, and
              you can republish at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onUnpublish}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/** The live share link with copy/open + quick links into the manage tabs. */
function ShareLink({
  shareUrl,
  formId,
  onClose,
}: {
  shareUrl: string;
  formId: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {shareUrl || "—"}
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <SVGIcon
            src={copied ? "/icons/tick.svg" : "/icons/copy.svg"}
            className="size-4"
          />
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          href={shareUrl || "#"}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          <SVGIcon src="/icons/open.svg" className="size-4" />
          Open
        </a>
      </div>

      {formId ? (
        <div className="space-y-0.5 pt-1">
          <ManageLink
            href={`/forms/${formId}/submissions`}
            icon="folder"
            label="View submissions"
            onNavigate={onClose}
          />
        </div>
      ) : null}
    </div>
  );
}

function InfoRow({
  icon,
  children,
}: {
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-foreground">
        <Icon name={icon} className="size-4" />
      </span>
      {children}
    </li>
  );
}

function ManageLink({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: IconName;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-foreground transition-colors hover:bg-muted"
    >
      <span className="flex items-center gap-2.5">
        <Icon name={icon} className="size-4 text-muted-foreground" />
        {label}
      </span>
      <svg
        viewBox="0 0 24 24"
        className="size-4 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  );
}
