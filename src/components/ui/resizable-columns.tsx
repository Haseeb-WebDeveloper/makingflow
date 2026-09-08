"use client";

import { useCallback, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * Column widths a person can drag, remembered per table.
 *
 * PORTED FROM THE CONTRACTOR-SITES OFFICE DASHBOARD, whose record table solved
 * this properly. Only the drag colour changed to our token; the reasoning below
 * is theirs and is why it works.
 *
 * WHY FIXED PIXELS AND NOT `fr`. The tables were fractional track lists, which is why the value
 * column overflowed into the assignee column: `minmax(0, 1fr)` shrinks a track below its content and
 * the content simply spills. Fractions also make a column's width a function of the window, so a
 * width somebody dragged would be undone by a resize. Fixed widths plus a horizontally scrolling
 * container is what every database table actually does — the table stops trying to fit the screen
 * and the screen scrolls instead.
 *
 * THE STATE IS PER TABLE, IN `localStorage`, and deliberately not on the server. It is a viewing
 * preference for one person on one machine; round-tripping it through the database would mean a
 * write on every drag and a column layout that follows somebody to a phone, where these widths are
 * meaningless because the table stacks.
 *
 * `useSyncExternalStore` RATHER THAN `useState` + an effect, and the difference is not stylistic.
 * The value differs between server and client by definition — the server has no `localStorage` — and
 * this hook is React's sanctioned answer to exactly that: `getServerSnapshot` supplies the defaults
 * for the server render and for hydration, `getSnapshot` supplies the stored widths immediately
 * after. Loading in an effect instead means setting state in an effect body, which is a cascading
 * render and which the lint rule correctly refuses.
 */

/** Below this a column is unreadable and the drag handles start overlapping each other. */
const MIN_WIDTH = 56;
const MAX_WIDTH = 800;

export type ColumnWidths = Record<string, number>;

type Store = {
  /**
   * The current widths, as ONE cached object.
   *
   * Referential stability is load-bearing: `getSnapshot` must return the same reference until
   * something actually changes, or React sees a new value on every render and loops forever.
   */
  snapshot: ColumnWidths;
  listeners: Set<() => void>;
  loaded: boolean;
};

/**
 * One store per table, at module scope.
 *
 * Outside React because the widths outlive any particular mount — collapse the panel, navigate away
 * and back, and the columns are where you left them without a second read from disk.
 */
const stores = new Map<string, Store>();

function readStored(key: string, defaults: ColumnWidths): ColumnWidths {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as unknown;
    if (!stored || typeof stored !== "object") return defaults;

    /**
     * Merge onto the defaults rather than replacing them, and take only known keys.
     *
     * A stored layout outlives the table it was saved from: add a column and an old entry has no
     * width for it; remove one and it has a width for nothing. Starting from `defaults` means a new
     * column appears at its designed width instead of collapsing to zero, and a stale key is
     * dropped rather than widening the grid by a phantom track.
     */
    const next = { ...defaults };
    for (const column of Object.keys(defaults)) {
      const value = (stored as Record<string, unknown>)[column];
      if (typeof value === "number" && Number.isFinite(value)) {
        next[column] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
      }
    }
    return next;
  } catch {
    // A corrupt or unavailable store (private mode, quota, a hand-edited value) is not worth a
    // broken table — the defaults are always a correct answer.
    return defaults;
  }
}

/**
 * The store for a table, created and hydrated on first use.
 *
 * Called during render and it mutates, which is normally a mistake — it is safe here because it is
 * idempotent and cached: the second call returns the same object with the same contents, so a
 * double render (StrictMode, a replayed hydration) cannot observe a difference.
 */
function getStore(key: string, defaults: ColumnWidths): Store {
  let store = stores.get(key);
  if (!store) {
    store = { snapshot: defaults, listeners: new Set(), loaded: false };
    stores.set(key, store);
  }
  if (!store.loaded && typeof window !== "undefined") {
    store.loaded = true;
    store.snapshot = readStored(key, defaults);
  }
  return store;
}

/**
 * Reading and writing the store live at MODULE scope, not inside the hook.
 *
 * Partly because that is where a mutable external store belongs, and partly because
 * `react-hooks/immutability` is right to refuse a hook callback that mutates a value it captured —
 * it cannot tell this object apart from React state, and the pattern it is guarding against looks
 * identical. Kept out here, the hook's callbacks only call functions.
 */
function snapshotOf(key: string, defaults: ColumnWidths): ColumnWidths {
  return getStore(key, defaults).snapshot;
}

function subscribeTo(key: string, defaults: ColumnWidths, onChange: () => void): () => void {
  const store = getStore(key, defaults);
  store.listeners.add(onChange);
  return () => {
    store.listeners.delete(onChange);
  };
}

function publish(key: string, defaults: ColumnWidths, next: ColumnWidths, persist: boolean) {
  const store = getStore(key, defaults);
  store.snapshot = next;
  for (const listener of store.listeners) listener();
  if (!persist) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Remembering the layout is a nicety, not a requirement.
  }
}

export function useColumnWidths(tableId: string, defaults: ColumnWidths) {
  const storageKey = `cols:${tableId}`;

  const widths = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => subscribeTo(storageKey, defaults, onChange),
      // `defaults` is a module constant at every call site; depending on its identity would
      // resubscribe on every render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [storageKey],
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useCallback(() => snapshotOf(storageKey, defaults), [storageKey]),
    // Hydration and the server render both use the designed widths, so the markup matches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useCallback(() => defaults, [storageKey]),
  );

  const startResize = useCallback(
    (column: string, event: React.PointerEvent) => {
      // The handle sits inside a header that is also a sort link. Without both of these, a drag
      // ends in a navigation to `?sort=<that column>`.
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = snapshotOf(storageKey, defaults)[column] ?? MIN_WIDTH;

      const onMove = (move: PointerEvent) => {
        const width = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, startWidth + (move.clientX - startX)),
        );
        const current = snapshotOf(storageKey, defaults);
        if (current[column] === width) return;
        // Not persisted per frame — one write at the end instead of one per pixel.
        publish(storageKey, defaults, { ...current, [column]: width }, false);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        // Held for the whole drag so the cursor does not flicker back to a text caret over the cells
        // the pointer crosses, and so a fast drag past the window edge keeps resizing.
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
        publish(storageKey, defaults, snapshotOf(storageKey, defaults), true);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
  );

  /** Back to the designed width — the conventional double-click on a column edge. */
  const resetColumn = useCallback(
    (column: string) => {
      const current = snapshotOf(storageKey, defaults);
      publish(storageKey, defaults, { ...current, [column]: defaults[column] ?? MIN_WIDTH }, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
  );

  const order = Object.keys(defaults);
  const template = order.map((column) => `${widths[column] ?? MIN_WIDTH}px`).join(" ");
  const totalWidth = order.reduce((sum, column) => sum + (widths[column] ?? MIN_WIDTH), 0);

  return { widths, template, totalWidth, startResize, resetColumn };
}

/**
 * The 4px strip on a column's trailing edge.
 *
 * Invisible until the header is hovered, then a hairline — Notion's, and the reason it works is that
 * the *hit area* is wider than the *mark*: a 7px box straddling the border makes the target forgiving
 * while the thing you see is one pixel.
 *
 * `touch-none` because a pointer drag on a touch screen would otherwise scroll the table instead of
 * moving the column.
 */
export function ResizeHandle({
  onResize,
  onReset,
  label,
}: {
  onResize: (event: React.PointerEvent) => void;
  onReset: () => void;
  label: string;
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      onPointerDown={onResize}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset();
      }}
      // Stops the header's sort link firing when a drag ends on top of it.
      onClick={(event) => event.preventDefault()}
      className={cn(
        "absolute -right-[3px] top-0 z-20 flex h-full w-[7px] cursor-col-resize touch-none justify-center",
        "opacity-0 transition-opacity hover:opacity-100 group-hover/head:opacity-60",
      )}
    >
      <span aria-hidden className="h-full w-px bg-foreground" />
    </span>
  );
}
