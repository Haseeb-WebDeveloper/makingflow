"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { aiFormSchema, type AiForm, type AiOperation } from "@/lib/ai/form-schema";
import {
  saveAiForm,
  publishForm,
  unpublishForm,
  deleteForm,
  updateFormSettings,
  type FormSettingsPatch,
} from "@/lib/actions/forms";
import { setFormDomain } from "@/lib/actions/domains";
import { buildShareUrl } from "@/lib/forms/share";
import type { FormSettingsData } from "@/lib/data/forms";
import type { WorkspaceFolder } from "@/lib/data/folders";
import {
  type EditorForm,
  type EditorSettings,
  editorToAi,
  mergeAiIntoEditor,
  applyOperations,
  matchSimpleEdit,
  newField,
  isBlankForm,
  isRebuildRequest,
} from "@/lib/builder/form-model";
import { aiEditForm } from "@/lib/actions/ai-edit";
import { useCreateForm } from "@/lib/forms/use-create-form";
import { appendFormChatMessage } from "@/lib/actions/form-chat";
import { uploadToCloudinary } from "@/lib/cloudinary/upload";
import type { FormChatMessage } from "@/lib/data/form-chat";
import {
  FormPreview,
  type PartialForm,
} from "@/components/builder/form-preview";
import { FormEditor, type BuilderTheme } from "@/components/builder/form-editor";
import type { SuccessPage } from "@/components/builder/success-page-editor";
import { FormRuntime } from "@/components/forms/form-runtime";
import { MemoizedMarkdown } from "@/components/forms/memoized-markdown";
import { Thinking } from "@/components/forms/thinking";
import type { PublicForm } from "@/lib/data/public-form";
import { Lottie } from "@/components/builder/lottie";
import { Composer, type ComposerImage } from "@/components/builder/composer";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { PublishDialog } from "@/components/builder/publish-dialog";
import { showToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SVGIcon } from "../ui/svg-icon";
import { Loading } from "../ui/loading";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  image?: string;
  // Attribution for a SHARED thread: who asked. Absent on assistant turns and
  // on messages created in this session (always the viewer).
  authorId?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

// Local ids for optimistically-appended chat messages. Must be globally unique:
// they share a React key space with the real row ids loaded from the database,
// and a counter would restart at page load and collide with them.
const rid = () => crypto.randomUUID();

const BUILDER_PHRASES = [
  "Reading your request…",
  "Designing the form…",
  "Working on fields…",
];

export function FormBuilder({
  initialForm,
  initialFormId,
  initialStatus,
  initialPublicId,
  initialDomainId,
  initialSlug,
  initialDomainHost,
  domains,
  folders,
  initialSettings,
  initialChat,
  viewerId,
}: {
  initialForm?: EditorForm;
  initialFormId?: string;
  initialStatus?: string;
  initialPublicId?: string | null;
  initialDomainId?: string | null;
  initialSlug?: string | null;
  initialDomainHost?: string | null;
  domains?: { id: string; domain: string }[];
  folders?: WorkspaceFolder[];
  initialSettings?: FormSettingsData | null;
  /** The form saved AI conversation — one shared thread per form. */
  initialChat?: FormChatMessage[];
  /** Current user, so the author label is hidden on your own messages. */
  viewerId?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { createForm } = useCreateForm();

  // Seeded from the form's saved thread (shared across the workspace). A form
  // with no history starts empty — the "Loaded …" greeting is rendered as a
  // placeholder further down rather than stored, so it can never be persisted
  // and repeat on every open.
  const [chat, setChat] = useState<ChatMessage[]>(() =>
    (initialChat ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      image: m.imageUrl ?? undefined,
      authorId: m.authorId,
      authorName: m.authorName,
      authorAvatarUrl: m.authorAvatarUrl,
    }))
  );
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<ComposerImage | null>(null);
  const [currentForm, setCurrentForm] = useState<EditorForm | null>(
    initialForm ?? null
  );
  const [formId, setFormId] = useState<string | null>(initialFormId ?? null);
  const [saveState, setSaveState] = useState<SaveState>(
    initialFormId ? "saved" : "idle"
  );
  const [published, setPublished] = useState(initialStatus === "published");
  const [publicId, setPublicId] = useState<string | null>(
    initialPublicId ?? null
  );
  const [publishing, setPublishing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [domainId, setDomainId] = useState<string | null>(
    initialDomainId ?? null
  );
  const [slug, setSlug] = useState<string | null>(initialSlug ?? null);
  const [domainHost, setDomainHost] = useState<string | null>(
    initialDomainHost ?? null
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [origin, setOrigin] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  // True while an operation-based edit (aiEditForm) is in flight. Combined with
  // useObject's `isLoading` (the create stream) into `busy` below.
  const [editing, setEditing] = useState(false);
  // Branding (logo/banner) edited inline on the canvas. Lives in `forms.theme`,
  // saved on its own debounced lane (updateFormSettings) — separate from the
  // field autosave (saveAiForm).
  const [theme, setTheme] = useState<BuilderTheme>({
    logoUrl: initialSettings?.logoUrl ?? undefined,
    coverImageUrl: initialSettings?.coverImageUrl ?? undefined,
  });
  const themeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The attachment upload in flight, so send() can wait on it rather than
  // handing the model a data URL it can't store.
  const uploadRef = useRef<{ url: string; promise: Promise<string | null> } | null>(null);
  // Post-submit success page — same debounced settings lane as branding.
  const [successPage, setSuccessPage] = useState<SuccessPage>({
    title: initialSettings?.thankYouMessage ?? "",
    body: initialSettings?.successBody ?? "",
    videoUrl: initialSettings?.successVideoUrl ?? null,
  });
  const successSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formIdRef = useRef<string | null>(initialFormId ?? null);
  const currentFormRef = useRef<EditorForm | null>(initialForm ?? null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Save serialization: only one saveAiForm runs at a time; the newest form is
  // queued in pendingSaveRef and flushed when the current save finishes — so
  // overlapping autosaves can't clobber (or double-create) the form.
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<EditorForm | null>(null);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  // Gate chat persistence until the saved thread is restored, so the empty
  // initial state can't overwrite a stored conversation on first render.
  // Whether the assistant has replied in this thread — drives the "Here's your
  // form" vs "Done. Updated the form." wording. A ref (not derived inside the
  // setChat updater) so the message text can be computed BEFORE the update and
  // handed to persistMessage.
  const hasAssistantRef = useRef((initialChat ?? []).some((m) => m.role === "assistant"));
  // Warn at most once per session if persistence fails — a toast per turn would
  // be worse than the problem.
  const persistWarnedRef = useRef(false);
  // Delete-on-leave: when "New form" created this draft and the user leaves it
  // still empty, discard it. `enteredBlank` is captured at mount; `discarded`
  // makes the delete fire at most once.
  const enteredBlankRef = useRef(
    initialForm ? isBlankForm(initialForm) : false
  );
  const draftDiscardedRef = useRef(false);

  const { object, submit, isLoading, error, stop } = useObject({
    api: "/api/ai/form",
    schema: aiFormSchema,
    onFinish: ({ object }) => {
      if (!object) return;
      // Merge onto the current form so manual ids + logic survive the AI edit.
      const full = mergeAiIntoEditor(object as AiForm, currentFormRef.current);
      currentFormRef.current = full;
      setCurrentForm(full);
      const isFirst = !hasAssistantRef.current;
      // Prefer the model's own 1-2 line summary of what it did so the chat
      // reads like a real conversation; fall back to a generic line.
      const summary = (object as AiForm)?.summary?.trim();
      const text = summary
        ? summary
        : isFirst
        ? full.title
          ? `Here's your form: “${full.title}”. Ask for any changes.`
          : "Here's your form. Ask for any changes."
        : "Done. Updated the form.";
      pushAssistant(text);
      scheduleAutosave(full);
    },
  });

  // The streaming partial (AI building) vs the committed editable form.
  const streaming = object as unknown as PartialForm | undefined;
  const headerTitle = currentForm?.title || streaming?.title || "New form";
  // "AI is working": the create stream (isLoading) OR an in-flight operation
  // edit (editing). The UI treats both the same way.
  const busy = isLoading || editing;
  // A blank draft (no fields, default title) shows the prompt UI even though it
  // already has an id/currentForm — only "real" content counts as started.
  const started =
    chat.length > 0 ||
    busy ||
    Boolean(object) ||
    (currentForm !== null && !isBlankForm(currentForm));
  // First build = no real form on the canvas yet (null, or a fresh blank draft).
  // In this state the AI is CREATING, not updating, so stream the form in as it
  // generates rather than showing the editor + an "Updating…" badge.
  const firstBuild = currentForm === null || isBlankForm(currentForm);
  // A custom domain (if attached) wins over the default link everywhere.
  const shareUrl = publicId
    ? buildShareUrl({ origin, publicId, domain: domainHost, slug })
    : "";

  // The committed form mapped to the public runtime shape, for the test preview.
  const previewForm: PublicForm | null = currentForm
    ? {
        publicId: publicId ?? "preview",
        title: currentForm.title || "Untitled form",
        submitLabel: initialSettings?.submitButtonLabel || "Submit",
        thankYou:
          successPage.title || "Looks good. This was a test, so no response was recorded.",
        successBody: successPage.body || null,
        successVideoUrl: successPage.videoUrl,
        redirectUrl: null, // never redirect in the builder preview
        showProgressBar: initialSettings?.showProgressBar ?? false,
        chooserStyle: initialSettings?.chooserStyle ?? "cards",
        // The preview always renders classic — conversational needs a published,
        // AI-enabled form + the live turn endpoint.
        renderMode: "classic",
        baseLanguage: "en",
        ai: null,
        theme:
          theme.logoUrl || theme.coverImageUrl
            ? {
                logoUrl: theme.logoUrl,
                coverImageUrl: theme.coverImageUrl,
              }
            : null,
        fields: currentForm.fields.map((f) => ({
          id: f.id,
          type: f.type,
          label: f.label,
          description: f.description,
          placeholder: f.placeholder,
          required: f.required,
          options: f.options,
          logic: f.logic,
          config: f.config,
        })),
      }
    : null;

  function updateForm(next: EditorForm) {
    currentFormRef.current = next;
    setCurrentForm(next);
    scheduleAutosave(next);
  }

  // Inline branding edits: update the preview immediately, persist (debounced)
  // to forms.theme via updateFormSettings. Best-effort — a save failure toasts
  // but doesn't block editing.
  function onThemeChange(next: BuilderTheme) {
    setTheme(next);
    if (!formId) return;
    if (themeSaveTimer.current) clearTimeout(themeSaveTimer.current);
    themeSaveTimer.current = setTimeout(() => {
      void updateFormSettings(formId, {
        logoUrl: next.logoUrl ?? null,
        coverImageUrl: next.coverImageUrl ?? null,
      }).then((res) => {
        if (!res.success) showToast(res.error ?? "Couldn't save branding", { type: "error" });
      });
    }, 600);
  }

  function onSuccessPageChange(next: SuccessPage) {
    setSuccessPage(next);
    if (!formId) return;
    if (successSaveTimer.current) clearTimeout(successSaveTimer.current);
    successSaveTimer.current = setTimeout(() => {
      void updateFormSettings(formId, {
        thankYouMessage: next.title || null,
        successBody: next.body || null,
        successVideoUrl: next.videoUrl ?? null,
      }).then((res) => {
        if (!res.success) showToast(res.error ?? "Couldn't save the success page", { type: "error" });
      });
    }, 600);
  }

  // Collect the net settings change from an edit's operations (AI or fast path),
  // or null if it touched no post-submit settings.
  function settingsFromOps(ops: AiOperation[]): EditorSettings | null {
    let out: EditorSettings | null = null;
    for (const op of ops) {
      if (op.op === "update_settings" && op.settings) out = { ...(out ?? {}), ...op.settings };
    }
    return out;
  }

  function themeFromOps(ops: AiOperation[]): BuilderTheme | null {
    let out: BuilderTheme | null = null;
    for (const op of ops) {
      if (op.op === "set_theme" && op.theme) out = { ...(out ?? {}), ...op.theme };
    }
    return out;
  }

  /** Apply an AI branding change through the SAME lane as the inline logo/banner
   *  controls, so the two writers can't clobber each other. An empty string from
   *  the model is a deliberate removal. */
  function applyThemeFromEdit(changed: BuilderTheme) {
    onThemeChange({
      ...theme,
      ...(changed.logoUrl !== undefined ? { logoUrl: changed.logoUrl || undefined } : {}),
      ...(changed.coverImageUrl !== undefined
        ? { coverImageUrl: changed.coverImageUrl || undefined }
        : {}),
    });
  }

  // Persist an AI/fast-path settings change through the SAME lane the Settings
  // tab and the on-canvas success-page editor use (updateFormSettings), and
  // reflect it live in the success-page editor. Keeping one writer avoids the
  // two lanes clobbering each other; the field autosave (saveAiForm) stays
  // structure-only.
  function applySettingsFromEdit(changed: EditorSettings) {
    if (changed.thankYouMessage !== undefined || changed.successBody !== undefined) {
      setSuccessPage((prev) => ({
        ...prev,
        ...(changed.thankYouMessage !== undefined ? { title: changed.thankYouMessage } : {}),
        ...(changed.successBody !== undefined ? { body: changed.successBody } : {}),
      }));
    }
    const id = formIdRef.current;
    if (!id) return;
    const patch: FormSettingsPatch = {};
    if (changed.thankYouMessage !== undefined) patch.thankYouMessage = changed.thankYouMessage || null;
    if (changed.successBody !== undefined) patch.successBody = changed.successBody || null;
    if (changed.submitButtonLabel !== undefined)
      patch.submitButtonLabel = changed.submitButtonLabel || null;
    if (changed.redirectUrl !== undefined) patch.redirectUrl = changed.redirectUrl || null;
    if (changed.showProgressBar !== undefined) patch.showProgressBar = changed.showProgressBar;
    if (changed.chooserStyle !== undefined) patch.chooserStyle = changed.chooserStyle;
    if (changed.renderMode !== undefined) patch.renderMode = changed.renderMode;
    if (Object.keys(patch).length === 0) return;
    void updateFormSettings(id, patch).then((res) => {
      if (!res.success) showToast(res.error ?? "Couldn't update settings", { type: "error" });
    });
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat, busy]);

  useEffect(() => {
    // Origin is only known on the client (used to build share links).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (themeSaveTimer.current) clearTimeout(themeSaveTimer.current);
      if (successSaveTimer.current) clearTimeout(successSaveTimer.current);
    };
  }, []);

  // The thread lives in the database (form_chat_messages) and arrives via
  // initialChat, so there is no client-side persistence step here — appends go
  // through persistMessage() as they happen.

  // Discard an abandoned blank draft. If "New form" created this form empty and
  // the user leaves it still empty — navigating away (the route instance is kept
  // alive by cacheComponents, so `usePathname` keeps updating) or closing the
  // tab (`pagehide`, keepalive) — ask the server to delete it. The server only
  // removes genuinely-empty drafts, so a form that gained any content is safe,
  // and `draftDiscardedRef` keeps it to a single request.
  function discardIfBlankDraft(keepalive: boolean) {
    const id = formIdRef.current;
    if (!id || draftDiscardedRef.current || !enteredBlankRef.current) return;
    const blankNow =
      currentFormRef.current === null || isBlankForm(currentFormRef.current);
    if (!blankNow) return;
    draftDiscardedRef.current = true;
    void fetch("/api/forms/draft", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ formId: id }),
      keepalive,
    }).catch(() => {});
  }

  const editPath = initialFormId ? `/forms/${initialFormId}/edit` : null;
  useEffect(() => {
    if (!editPath || pathname === editPath) return;
    discardIfBlankDraft(false);
  }, [pathname, editPath]);

  useEffect(() => {
    const onHide = () => discardIfBlankDraft(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  // Keep the ref in sync so AI edits merge onto the latest form (incl. manual edits).
  useEffect(() => {
    currentFormRef.current = currentForm;
  }, [currentForm]);

  // ── Persistence ───────────────────────────────────────────────────
  /**
   * Persist the latest queued form. Single-flight: if a save is already running
   * it returns the in-flight promise (the running loop picks up newer state),
   * so saves never overlap and the most recent edit always wins.
   */
  function flushSave(): Promise<void> {
    if (savingRef.current) return savePromiseRef.current ?? Promise.resolve();
    savingRef.current = true;
    const run = (async () => {
      try {
        while (pendingSaveRef.current) {
          const form = pendingSaveRef.current;
          pendingSaveRef.current = null;
          setSaveState("saving");
          const res = await saveAiForm({ formId: formIdRef.current, form });
          if (res.success) {
            formIdRef.current = res.id;
            setFormId(res.id);
          } else {
            setSaveState("error");
            showToast(res.error, { type: "error" });
            return;
          }
        }
        setSaveState("saved");
      } finally {
        savingRef.current = false;
      }
    })();
    savePromiseRef.current = run;
    return run;
  }

  function scheduleAutosave(formToSave: EditorForm) {
    pendingSaveRef.current = formToSave;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(), 800);
  }

  function saveNow() {
    if (!currentForm || busy) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSaveRef.current = currentForm;
    void flushSave();
  }

  async function publish() {
    if (!currentForm || busy || publishing) return;
    setPublishing(true);
    // Flush the latest edits (and create the form if needed) before publishing —
    // shares the single-flight saver so it can't race an in-flight autosave.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSaveRef.current = currentForm;
    await flushSave();
    const id = formIdRef.current;
    if (!id) {
      setPublishing(false);
      showToast("Could not save the form", { type: "error" });
      return;
    }
    const res = await publishForm(id);
    setPublishing(false);
    if (res.success) {
      setPublished(true);
      setPublicId(res.publicId);
      showToast("Your form is live 🎉", { type: "success" });
    } else {
      showToast(res.error, { type: "error" });
    }
  }

  async function unpublish() {
    const id = formIdRef.current;
    if (!id) return;
    const res = await unpublishForm(id);
    if (res.success) setPublished(false);
    else showToast(res.error ?? "Could not unpublish", { type: "error" });
  }

  /**
   * Attach the form to a custom domain (or clear it). Ensures the form is saved
   * first, then persists; updates local state so the share link reflects it.
   */
  async function applyDomain(
    nextId: string | null,
    nextSlug: string | null
  ): Promise<{ success: boolean; error?: string }> {
    if (!formIdRef.current) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingSaveRef.current = currentFormRef.current;
      await flushSave();
    }
    const id = formIdRef.current;
    if (!id) return { success: false, error: "Save the form first" };

    const res = await setFormDomain(id, {
      customDomainId: nextId,
      slug: nextSlug,
    });
    if (res.success) {
      setDomainId(nextId);
      setSlug(res.slug);
      setDomainHost(res.domain);
    }
    return res;
  }

  async function handleDelete() {
    setDeleting(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const id = formIdRef.current;
    if (id) {
      const res = await deleteForm(id);
      if (!res.success) {
        setDeleting(false);
        showToast(res.error ?? "Could not delete the form", { type: "error" });
        return;
      }
    }
    showToast("Form deleted", { type: "success" });
    router.push("/forms");
  }

  // ── Conversation ──────────────────────────────────────────────────

  /**
   * Write one turn to the form's shared thread. Fire-and-forget: the local chat
   * is what the user sees, so a failed write must never block editing or drop
   * the bubble — it only means this turn won't survive a reload.
   */
  function persistMessage(
    role: "user" | "assistant",
    text: string,
    imageUrl?: string | null,
  ) {
    const id = formIdRef.current;
    if (!id || (!text.trim() && !imageUrl)) return;
    void appendFormChatMessage({ formId: id, role, text, imageUrl })
      .then((r) => {
        if (r.success || persistWarnedRef.current) return;
        persistWarnedRef.current = true;
        showToast("Couldn't save the conversation — this thread won't survive a reload.", {
          type: "error",
        });
      })
      .catch(() => {
        /* network hiccup — the local thread is unaffected */
      });
  }

  /** Append an assistant turn locally and persist it. */
  function pushAssistant(text: string) {
    hasAssistantRef.current = true;
    setChat((prev) => [...prev, { id: rid(), role: "assistant", text }]);
    persistMessage("assistant", text);
  }

  /** The attachment's hosted URL, waiting on the upload if it's still running. */
  async function hostedUrlFor(img: ComposerImage | null): Promise<string | null> {
    if (!img) return null;
    if (img.hostedUrl) return img.hostedUrl;
    const pending = uploadRef.current;
    return pending && pending.url === img.url ? await pending.promise : null;
  }

  async function send() {
    if (busy) return;
    const text = draft.trim();
    if (!text && !image) return;

    const transcript = chat.map((m) => ({ role: m.role, text: m.text }));
    const userText = text || "Recreate this form from the reference image.";
    const attachment = image;
    setChat((prev) => [
      ...prev,
      {
        id: rid(),
        role: "user",
        text: userText,
        // Preview uses the local data URL; history uses the uploaded copy.
        image: attachment?.hostedUrl ?? attachment?.url,
        authorId: viewerId ?? null,
      },
    ]);
    setDraft("");
    setImage(null);

    // The upload starts on attach and is normally done by the time the prompt
    // is typed, so this usually resolves instantly.
    const hostedUrl = await hostedUrlFor(attachment);
    persistMessage("user", userText, hostedUrl);

    // Editing an existing form = operation-based edit (deterministic, can't drop
    // unrelated fields/options). Only a FIRST build, or an explicit ask to
    // rebuild from the picture, goes to streaming full-form generation — an
    // attachment alone used to force it, so "use this as the logo" rebuilt the
    // whole form from a picture of a logo.
    if (!firstBuild && text && !isRebuildRequest(text)) {
      void runEdit(text, transcript, hostedUrl ?? undefined);
      return;
    }
    submit({
      instruction: text,
      image: attachment?.url,
      current: currentForm ? editorToAi(currentForm) : undefined,
      transcript,
    });
  }

  // Operation-based edit: ask the model for a list of changes, apply them in
  // code, then commit + autosave. The form is already on screen, so there's no
  // streaming preview — the "Updating…" state covers the wait.
  async function runEdit(
    instruction: string,
    transcript: { role: "user" | "assistant"; text: string }[],
    imageUrl?: string,
  ) {
    const base = currentFormRef.current;
    if (!base) return;
    setEditing(true);
    try {
      // Deterministic fast path: trivial, unambiguous edits (e.g. "make Email
      // optional") are applied in code with no model call — instant and 100%
      // reliable, with no chance of the AI looping or picking the wrong op.
      const simple = matchSimpleEdit(instruction, base);
      if (simple) {
        const updated = applyOperations(base, simple.operations);
        currentFormRef.current = updated;
        setCurrentForm(updated);
        const changed = settingsFromOps(simple.operations);
        if (changed) applySettingsFromEdit(changed);
        const branding = themeFromOps(simple.operations);
        if (branding) applyThemeFromEdit(branding);
        pushAssistant(simple.summary);
        scheduleAutosave(updated);
        return;
      }
      const result = await aiEditForm({
        instruction,
        current: base,
        transcript,
        imageUrl,
        // The share link is computed here and nowhere else — without it the
        // model has nothing to answer "what's the form link?" with but a guess.
        facts: {
          shareUrl: publicId ? shareUrl : null,
          status: published ? "published" : initialStatus ?? "draft",
        },
      });
      if ("error" in result) {
        pushAssistant("Sorry, I couldn't apply that change. Please try rephrasing it.");
        return;
      }
      if (process.env.NODE_ENV === "development") {
        console.debug("[ai-edit] operations:", result.operations);
      }
      // Use the server-applied form directly: it already ran the operations plus
      // the verify-and-repair pass, and newly-added fields keep the ids the
      // repair pass targeted (re-applying here would mint different ids). Fall
      // back to a local apply only if the server didn't return a form.
      // A question ("what's the form link?") is answered with zero operations.
      // Nothing changed, so don't touch the form or kick off a save that would
      // flash "Saving…" over an unmodified canvas.
      if (result.operations.length === 0) {
        pushAssistant(result.summary?.trim() || "I don't have an answer for that.");
        return;
      }
      const updated =
        result.form ?? applyOperations(currentFormRef.current ?? base, result.operations);
      currentFormRef.current = updated;
      setCurrentForm(updated);
      const changed = settingsFromOps(result.operations);
      if (changed) applySettingsFromEdit(changed);
      const branding = themeFromOps(result.operations);
      if (branding) applyThemeFromEdit(branding);
      const summary = result.summary?.trim();
      pushAssistant(summary || "Done. Updated the form.");
      scheduleAutosave(updated);
    } catch (err) {
      console.error("[form-builder] edit failed", err);
      pushAssistant("Sorry, something went wrong. Please try again.");
    } finally {
      setEditing(false);
    }
  }

  // "Start over" = a brand-new form. Create a fresh draft and go to its editor;
  // the current form is left as-is (a still-blank draft is cleaned up by the
  // delete-on-leave effect when the route changes).
  function startOver() {
    stop();
    createForm();
  }

  async function pickFile(file: File) {
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", { type: "error" });
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      showToast("That image is too large (max 12MB).", { type: "error" });
      return;
    }
    let url: string;
    try {
      url = await fileToDataUrl(file);
    } catch {
      showToast("Couldn't read that image. Try another one.", {
        type: "error",
      });
      return;
    }
    // Show the preview immediately from the local data URL, then upload a copy
    // in the background so the turn can be stored with a real URL. Uploading
    // here rather than on send keeps send latency unchanged — by the time the
    // user has typed their prompt the URL is normally ready.
    setImage({ url, name: file.name });
    const upload = uploadToCloudinary(file, "formAssets")
      .then(({ secureUrl }) => {
        setImage((prev) =>
          // Guard against the user having removed or replaced it mid-upload.
          prev && prev.url === url ? { ...prev, hostedUrl: secureUrl } : prev
        );
        return secureUrl;
      })
      .catch(() => {
        // Non-fatal: the AI still gets the image, it just won't appear in the
        // saved history. Silent — the user asked to attach, not to upload.
        console.warn("[form-builder] reference image upload failed");
        return null;
      });
    // Held so a fast sender can await it — the editor needs the hosted URL to
    // set a logo, and a data URL is no use to it.
    uploadRef.current = { url, promise: upload };
    await upload;
  }

  // Start a blank form by hand — the no-AI path, so a form can always be built
  // even if Gemini is unavailable (AI is additive, never required for basics).
  function startBlank() {
    updateForm({ title: "Untitled form", fields: [newField("short_text")] });
    setMode("edit");
  }

  // ── Empty state — describe the form ───────────────────────────────
  if (!started) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          <div className="mb-6 flex flex-col items-center text-center">
            <Lottie name="ai" className="size-32" />
            <h1 className="mt-2 font-sebenta text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Describe your form
            </h1>
            <p className="mt-3 max-w-md text-muted-foreground">
              Tell MakingFlow what you need in plain language and it builds the
              form live, then refines it as you ask for changes.
            </p>
          </div>

          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void send()}
            placeholder="Describe your form, or attach a screenshot to recreate (e.g. a job application with a portfolio link and availability)…"
            image={image}
            onRemoveImage={() => setImage(null)}
            onPickFile={pickFile}
            busy={busy}
            submitLabel="Generate form"
            rows={3}
            maxRows={10}
            autoFocus
            animatedBorder
          />

          <div className="mt-5 flex items-center justify-center gap-3 text-sm text-muted-foreground">
            <span className="h-px w-8 bg-border" />
            <span>or</span>
            <button
              type="button"
              onClick={startBlank}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              start from scratch
            </button>
            <span className="h-px w-8 bg-border" />
          </div>
        </div>
      </div>
    );
  }

  // ── Active state — conversation + live preview ────────────────────
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-auto lg:flex-row">
      <aside className="flex h-1/2 shrink-0 flex-col border-b border-border lg:sticky lg:top-0 lg:h-[calc(100dvh-3.5rem)] lg:self-start lg:w-[380px] lg:border-b-0 lg:border-r">
        <div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* An existing form with no saved thread yet: greet, but do NOT store
              the greeting — otherwise it would be persisted and repeat on every
              open, and every teammate would see a stack of them. */}
          {chat.length === 0 && !busy && currentForm && !isBlankForm(currentForm) ? (
            <AssistantRow
              text={`Loaded “${currentForm.title}”. Ask for any changes.`}
            />
          ) : null}
          {chat.map((m) =>
            m.role === "user" ? (
              <UserBubble key={m.id} message={m} viewerId={viewerId} />
            ) : (
              <AssistantRow key={m.id} id={m.id} text={m.text} />
            )
          )}
          {busy ? <AssistantRow building /> : null}
          {error ? (
            <div className="ml-8 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Something went wrong. Check your AI API key and try again.
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border p-3">
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void send()}
            placeholder="Ask for changes (e.g. add a phone number, make email required)…"
            image={image}
            onRemoveImage={() => setImage(null)}
            onPickFile={pickFile}
            busy={busy}
            submitLabel=""
            rows={2}
            maxRows={5}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="mt-2 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Stop generating
            </button>
          ) : null}
        </div>
      </aside>

      <main className="relative flex h-1/2 min-w-0 flex-1 flex-col lg:h-fit">
        <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 sm:px-5 lg:sticky lg:top-0 lg:z-10">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                router.push(formId ? `/forms/${formId}` : "/forms")
              }
              aria-label="Back"
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <p className="min-w-0 truncate font-sebenta text-sm font-semibold text-foreground">
              {headerTitle}
            </p>
            {published ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                <span className="size-1.5 rounded-full bg-success" />
                Live
              </span>
            ) : null}
            <SaveStatus state={saveState} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ModeToggle
              mode={mode}
              onChange={setMode}
              disabled={busy || !currentForm}
            />
            <Button
              variant="outline"
              onClick={saveNow}
              disabled={!currentForm || busy || saveState === "saving"}
              className="h-8 px-3"
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                ? "Saved"
                : "Save"}
            </Button>
            <Button
              onClick={() => setPublishOpen(true)}
              disabled={!currentForm || busy}
              className="h-8 px-3"
            >
              {published ? "Share" : "Publish"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="More options"
                  className="size-8 px-0 text-muted-foreground"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="size-5"
                    fill="currentColor"
                    aria-hidden
                  >
                    <circle cx="12" cy="5" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="12" cy="19" r="1.6" />
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={startOver}>
                  <SVGIcon
                    src="/icons/plus.svg"
                    className="size-4 text-muted-foreground"
                  />
                  New form
                </DropdownMenuItem>
                {published ? (
                  <DropdownMenuItem onSelect={unpublish}>
                    <Icon
                      name="hide"
                      className="size-4 text-muted-foreground"
                    />
                    Unpublish
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setDeleteOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Icon name="delete" className="size-4 text-destructive" />
                  Delete form
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="thin-scroll flex-1 overflow-x-hidden overflow-y-auto bg-canvas px-6 py-10 sm:px-10">
          {firstBuild ? (
            // First generation — there's nothing real to show yet, so stream the
            // form in as it builds.
            <FormPreview form={streaming} building={isLoading} />
          ) : mode === "preview" && previewForm ? (
            <FormRuntime form={previewForm} testMode />
          ) : (
            // Editing an existing form: keep it on screen (faded + locked) while
            // the AI applies changes — never blank it back to a building skeleton.
            <div
              className={cn(
                busy &&
                  "pointer-events-none select-none opacity-50 transition-opacity"
              )}
            >
              <FormEditor
                form={currentForm}
                onChange={updateForm}
                theme={theme}
                onThemeChange={onThemeChange}
                successPage={successPage}
                onSuccessPageChange={onSuccessPageChange}
              />
            </div>
          )}
        </div>

        {/* Panel-level so it stays centered and visible no matter where the
            canvas is scrolled. */}
      </main>
      {busy && !firstBuild ? (
        <div className="pointer-events-none absolute inset-0 pl-[380px] z-20 flex items-center justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-md backdrop-blur">
            <Loading fill className="size-4 shrink-0" />
            Updating…
          </span>
        </div>
      ) : null}

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        published={published}
        publishing={publishing}
        shareUrl={shareUrl}
        formId={formId}
        formTitle={headerTitle}
        domains={domains}
        domainId={domainId}
        slug={slug}
        domainHost={domainHost}
        onSetDomain={applyDomain}
        folders={folders}
        settings={initialSettings ?? null}
        formStatus={published ? "published" : initialStatus ?? "draft"}
        onPublish={publish}
        onUnpublish={unpublish}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this form?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{headerTitle}” and all of its
              submissions. Uploaded files and images are also erased from
              storage. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              {deleting ? "Deleting…" : "Delete form"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: "edit" | "preview";
  onChange: (m: "edit" | "preview") => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
      {(["edit", "preview"] as const).map((m) => (
        <button
          key={m}
          type="button"
          disabled={disabled}
          onClick={() => onChange(m)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50",
            mode === m
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const label =
    state === "saving"
      ? "Saving…"
      : state === "saved"
      ? "Saved"
      : "Save failed";
  return (
    <span
      className={cn(
        "shrink-0 text-xs",
        state === "error" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}

function UserBubble({
  message,
  viewerId,
}: {
  message: ChatMessage;
  viewerId?: string;
}) {
  // The thread is shared, so a teammate's turn is labelled with their name.
  // Your own turns stay unlabelled — in the common solo case the chat should
  // look exactly as it did before.
  const author =
    message.authorId && message.authorId !== viewerId ? message.authorName : null;
  return (
    <div className="flex flex-col items-end gap-1">
      {author ? (
        <span className="pr-1 text-xs text-muted-foreground">{author}</span>
      ) : null}
      <div className="max-w-[88%] rounded-md rounded-br-sm bg-foreground px-3.5 py-2 text-sm text-background">
        {message.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.image}
            alt=""
            className="mb-2 max-h-40 w-full rounded-lg object-cover"
          />
        ) : null}
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  );
}

function AssistantRow({
  id,
  text,
  building,
}: {
  id?: string;
  text?: string;
  building?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo/logo.svg"
        alt=""
        className="mt-1 size-6 shrink-0 rounded-md object-contain"
      />
      {building ? (
        <Thinking phrases={BUILDER_PHRASES} className="pt-1" />
      ) : (
        // Render markdown so emphasis (**bold**, *italic*, lists) in the AI's
        // summary shows as formatted text instead of raw asterisks/quotes.
        <div className="min-w-0 flex-1 pt-0.5">
          <MemoizedMarkdown content={text ?? ""} id={id ?? "assistant"} />
        </div>
      )}
    </div>
  );
}

/**
 * Read an image File into a data URL, downscaling its long edge so the payload
 * (and Gemini's image tokens) stay reasonable. Falls back to the original.
 */
async function fileToDataUrl(file: File, maxEdge = 1568): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  try {
    const img = await loadImage(dataUrl);
    const longEdge = Math.max(img.width, img.height);
    const scale = Math.min(1, maxEdge / longEdge);
    if (scale === 1) return dataUrl;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch {
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
