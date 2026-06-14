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
import type { FormSettingsData } from "@/lib/data/forms";
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
      <DialogContent className="max-h-[95vh] overflow-y-auto w-fit">
        <DialogHeader>
          {published ? (
            <>
              <DialogTitle className="flex items-center gap-2 lg:gap-[0.556vw]">
                <span className="size-2 lg:size-[0.556vw] rounded-full bg-success" />
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
                the link can respond — you can unpublish any time.
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
          <ul className="space-y-2.5 lg:space-y-[0.694vw] py-1 lg:py-[0.278vw] text-sm lg:text-[0.972vw] text-muted-foreground">
            <InfoRow icon="discovery">Get a shareable public link</InfoRow>
            <InfoRow icon="folder">
              Start collecting responses instantly
            </InfoRow>
            <InfoRow icon="edit">Edits you make go live automatically</InfoRow>
          </ul>
        )}

        {domains && domains.length > 0 && onSetDomain ? (
          <section className="border-t border-border pt-4 lg:pt-[1.111vw]">
            <h3 className="text-sm lg:text-[0.972vw] font-semibold text-foreground">
              Custom domain
            </h3>
            <p className="mt-0.5 lg:mt-[0.139vw] mb-3 lg:mb-[0.833vw] text-sm lg:text-[0.972vw] text-muted-foreground">
              Serve this form from one of your connected domains — change or
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
          <section className="border-t border-border pt-4 lg:pt-[1.111vw]">
            <h3 className="text-sm lg:text-[0.972vw] font-semibold text-foreground">
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

        <DialogFooter className="sticky -bottom-6 z-10 -mx-6 -mb-6 mt-0 items-center gap-2 lg:gap-[0.556vw] border-t border-border bg-popover px-6 pt-4 pb-6 sm:justify-between lg:-bottom-[1.667vw] lg:-mx-[1.667vw] lg:-mb-[1.667vw] lg:px-[1.667vw] lg:pt-[1.111vw] lg:pb-[1.667vw]">
          {published ? (
            <>
              <Button
                variant="destructive"
                onClick={() => setConfirmUnpublish(true)}
              >
                Unpublish
              </Button>
              <div className="flex items-center gap-2 lg:gap-[0.556vw]">
                {settingsDirty ? (
                  <Button
                    onClick={() => void settingsRef.current?.save()}
                    disabled={settingsSaving}
                  >
                    {settingsSaving ? "Saving…" : "Save changes"}
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <div className="flex w-full items-center gap-2 lg:gap-[0.556vw]">
              {settingsDirty ? (
                <Button
                  variant="outline"
                  onClick={() => void settingsRef.current?.save()}
                  disabled={settingsSaving}
                  className="shrink-0"
                >
                  {settingsSaving ? "Saving…" : "Save changes"}
                </Button>
              ) : null}
              <Button
                onClick={onPublish}
                disabled={publishing}
                className="flex-1"
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
              The public link will stop working immediately and visitors won&apos;t
              be able to respond. Existing submissions are kept, and you can
              republish at any time.
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
    <div className="space-y-1 lg:space-y-[0.278vw]">
      <div className="flex items-center gap-2 lg:gap-[0.556vw]">
        <div className="min-w-0 flex-1 truncate rounded-md lg:rounded-[0.556vw] border border-border bg-muted/40 px-3 lg:px-[0.833vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-muted-foreground">
          {shareUrl || "—"}
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 lg:h-[2.5vw] shrink-0 items-center gap-1.5 lg:gap-[0.417vw] rounded-md lg:rounded-[0.556vw] border border-border px-3 lg:px-[0.833vw] text-sm lg:text-[0.972vw] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <SVGIcon
            src={copied ? "/icons/tick.svg" : "/icons/copy.svg"}
            className="size-4 lg:size-[1.111vw]"
          />
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          href={shareUrl || "#"}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 lg:h-[2.5vw] shrink-0 items-center gap-1.5 lg:gap-[0.417vw] rounded-md lg:rounded-[0.556vw] bg-foreground px-3 lg:px-[0.833vw] text-sm lg:text-[0.972vw] font-medium text-background transition-colors hover:bg-foreground/90"
        >
          <SVGIcon src="/icons/open.svg" className="size-4 lg:size-[1.111vw]" />
          Open
        </a>
      </div>

      {formId ? (
        <div className="space-y-0.5 lg:space-y-[0.139vw] pt-1 lg:pt-[0.278vw]">
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
    <li className="flex items-center gap-2.5 lg:gap-[0.694vw]">
      <span className="grid size-7 lg:size-[1.944vw] shrink-0 place-items-center rounded-md lg:rounded-[0.556vw] bg-muted text-foreground">
        <Icon name={icon} className="size-4 lg:size-[1.111vw]" />
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
      className="flex items-center justify-between gap-2 lg:gap-[0.556vw] rounded-md lg:rounded-[0.556vw] px-2 lg:px-[0.556vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-foreground transition-colors hover:bg-muted"
    >
      <span className="flex items-center gap-2.5 lg:gap-[0.694vw]">
        <Icon name={icon} className="size-4 lg:size-[1.111vw] text-muted-foreground" />
        {label}
      </span>
      <svg
        viewBox="0 0 24 24"
        className="size-4 lg:size-[1.111vw] text-muted-foreground"
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
