import { afterEach, describe, expect, test, vi } from "vitest"
import {
  archiveEntryName,
  ARCHIVE_ASSET_LIMIT,
  archiveSlug,
  attachmentUrl,
  buildMediaArchives,
  collectAssets,
  groupByResourceType,
} from "@/lib/submissions/export-media"
import type { ExportSubmission } from "@/lib/submissions/export-row"

function sub(files: ExportSubmission["files"]): ExportSubmission {
  return {
    id: "s1",
    createdAt: new Date(),
    completedAt: new Date(),
    status: "completed",
    language: null,
    mode: "classic",
    reviewStatus: "new",
    tags: [],
    aiSummary: null,
    aiScore: null,
    aiScreenReason: null,
    calculations: null,
    meta: null,
    values: {},
    removed: {},
    followUps: [],
    files,
  }
}

const source = (rows: ExportSubmission[]) =>
  ({
    form: { id: "f", title: "Roles" },
    columns: [],
    sources: { fields: [], removedQuestions: [], followUpCount: 0, timezone: "UTC" },
    rows: (async function* () {
      for (const r of rows) yield r
    })(),
  }) as never

describe("export media", () => {
  /**
   * These three cases are how the live API actually behaves, checked against
   * the real account — an image asset's public id carries no extension and
   * Cloudinary appends its stored format, a raw asset's already carries one and
   * must not be given a second.
   */
  test("an image entry gets the extension Cloudinary stored, taken from the delivery URL", () => {
    expect(
      archiveEntryName(
        "makingflow/submissions/ab12",
        "Ayesha CV.pdf",
        "https://res.cloudinary.com/demo/image/upload/v17/makingflow/submissions/ab12.pdf",
      ),
    ).toBe("ab12.pdf")
  })

  test("a raw entry keeps the extension already in its public id, never doubled", () => {
    expect(
      archiveEntryName(
        "makingflow/submissions/ab12.docx",
        "cv.docx",
        "https://res.cloudinary.com/demo/raw/upload/v17/makingflow/submissions/ab12.docx",
      ),
    ).toBe("ab12.docx")
  })

  test("with no delivery URL the uploaded name supplies the extension", () => {
    expect(archiveEntryName("makingflow/submissions/ab12", "cv.pdf")).toBe("ab12.pdf")
    expect(archiveEntryName("makingflow/submissions/ab12", "photo")).toBe("ab12")
    // A query string on the URL must not become part of the name.
    expect(archiveEntryName("x/ab12", "cv.pdf", "https://res.test/ab12.pdf?v=2")).toBe("ab12.pdf")
  })

  test("assets are collected across submissions and de-duplicated", async () => {
    const shared = { path: "p", url: "u", name: "cv.pdf", storageKey: "k1", mime: "application/pdf" }
    const assets = await collectAssets(
      source([
        sub([shared]),
        sub([shared, { ...shared, storageKey: "k2", mime: "image/png", name: "id.png" }]),
      ]),
    )
    expect(assets).toEqual([
      { publicId: "k1", resourceType: "raw", ext: "pdf" },
      { publicId: "k2", resourceType: "image", ext: "png" },
    ])
  })

  test("a file with no storage key is recovered from its delivery URL", async () => {
    const assets = await collectAssets(
      source([
        sub([
          {
            path: "p",
            url: "https://res.cloudinary.com/demo/image/upload/v1700000000/makingflow/submissions/legacy.png",
            name: "legacy.png",
          },
        ]),
      ]),
    )
    expect(assets).toEqual([
      { publicId: "makingflow/submissions/legacy", resourceType: "image", ext: "png" },
    ])
  })

  test("a file we cannot address at all is skipped rather than failing the export", async () => {
    const assets = await collectAssets(
      source([sub([{ path: "p", url: "https://someone-elses-cdn.test/x.pdf", name: "x.pdf" }])]),
    )
    expect(assets).toEqual([])
  })

  test("assets are grouped by resource type and split at Cloudinary's own ceiling", () => {
    const many = Array.from({ length: ARCHIVE_ASSET_LIMIT + 5 }, (_, i) => ({
      publicId: `k${i}`,
      resourceType: "raw" as const,
      ext: "docx",
    }))
    const groups = groupByResourceType([
      ...many,
      { publicId: "img", resourceType: "image", ext: "pdf" },
    ])
    expect(groups).toHaveLength(3)
    expect(groups[0].publicIds).toHaveLength(ARCHIVE_ASSET_LIMIT)
    expect(groups[1].publicIds).toHaveLength(5)
    expect(groups[2]).toEqual({ resourceType: "image", publicIds: ["img"], formats: ["PDF"] })
    // The label a person reads comes from the file types, not the resource type.
    expect(groups[0].formats).toEqual(["DOCX"])
    expect(ARCHIVE_ASSET_LIMIT).toBe(1000)
  })

  test("a download URL forces the browser to save the zip under a readable name", () => {
    expect(
      attachmentUrl("https://res.cloudinary.com/demo/raw/upload/v17/makingflow/exports/a.zip", "roles-files"),
    ).toBe("https://res.cloudinary.com/demo/raw/upload/fl_attachment:roles-files/v17/makingflow/exports/a.zip")
  })

  test("a URL that is not a Cloudinary delivery URL is handed back untouched", () => {
    expect(attachmentUrl("https://elsewhere.test/a.zip", "roles")).toBe("https://elsewhere.test/a.zip")
  })
})

/**
 * The archive call itself, with only the network faked.
 *
 * Both of these are regressions against real bugs found by probing the live
 * API: a comma-joined `public_ids` is read as one literal id and returns a
 * cheerful 200 holding an empty zip, and `allow_missing` is what makes that
 * silent.
 */
describe("createArchive over the wire", () => {
  const asset = (key: string, mime: string, name: string) => ({
    path: "p",
    url: `https://res.cloudinary.com/demo/raw/upload/v17/${key}`,
    name,
    storageKey: key,
    mime,
  })

  function stubCloudinary(response: Record<string, unknown>, status = 200) {
    const calls: { url: string; body: FormData }[] = []
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "demo")
    vi.stubEnv("CLOUDINARY_API_KEY", "key")
    vi.stubEnv("CLOUDINARY_API_SECRET", "secret")
    vi.stubGlobal("fetch", async (url: string, init: { body: FormData }) => {
      calls.push({ url, body: init.body })
      return new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      })
    })
    return calls
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test("sends one public_ids[] entry per asset, not one comma-joined field", async () => {
    const calls = stubCloudinary({
      secure_url: "https://res.cloudinary.com/demo/raw/upload/v17/makingflow/exports/a.zip",
      public_id: "makingflow/exports/a.zip",
      file_count: 2,
      bytes: 4096,
    })

    const result = await buildMediaArchives(
      source([
        sub([asset("makingflow/submissions/aaa.docx", "application/msword", "a.docx")]),
        sub([asset("makingflow/submissions/bbb.docx", "application/msword", "b.docx")]),
      ]),
      new Date("2026-09-22T00:00:00.000Z"),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain("/raw/generate_archive")
    expect(calls[0].body.getAll("public_ids[]")).toEqual([
      "makingflow/submissions/aaa.docx",
      "makingflow/submissions/bbb.docx",
    ])
    expect(calls[0].body.get("public_ids")).toBeNull()
    // The signature still covers the comma-joined value, which is what the API
    // expects — so it must NOT be recomputed from the bracketed entries.
    expect(calls[0].body.get("signature")).toBeTruthy()
    expect(result.archives[0].fileCount).toBe(2)
    expect(result.archives[0].requested).toBe(2)
    expect(result.archives[0].formats).toEqual(["DOCX"])
    expect(result.archives[0].url).toContain("fl_attachment:roles-files-2026-09-22")
  })

  test("an empty archive is refused rather than handed over as an answer", async () => {
    stubCloudinary({
      secure_url: "https://res.cloudinary.com/demo/raw/upload/v17/makingflow/exports/a.zip",
      public_id: "makingflow/exports/a.zip",
      file_count: 0,
      bytes: 22,
    })

    await expect(
      buildMediaArchives(
        source([sub([asset("makingflow/submissions/aaa.docx", "application/msword", "a.docx")])]),
        new Date("2026-09-22T00:00:00.000Z"),
      ),
    ).rejects.toThrow(/came back empty/i)
  })

  test("a shortfall is reported rather than hidden by allow_missing", async () => {
    stubCloudinary({
      secure_url: "https://res.cloudinary.com/demo/raw/upload/v17/makingflow/exports/a.zip",
      public_id: "makingflow/exports/a.zip",
      file_count: 1,
      bytes: 2048,
    })

    const result = await buildMediaArchives(
      source([
        sub([asset("makingflow/submissions/aaa.docx", "application/msword", "a.docx")]),
        sub([asset("makingflow/submissions/bbb.docx", "application/msword", "b.docx")]),
      ]),
      new Date("2026-09-22T00:00:00.000Z"),
    )
    expect(result.archives[0]).toMatchObject({ fileCount: 1, requested: 2 })
  })
})

/**
 * Download names, which a person reads twice: once in a dialog and once in
 * their Downloads folder.
 */
describe("archiveSlug", () => {
  test("a long form title is cut at a word boundary, not left to run", () => {
    const slug = archiveSlug("Meta Paid Advertising Specialist — Application & Screening Form")
    expect(slug).toBe("meta-paid-advertising")
    expect(slug.length).toBeLessThanOrEqual(32)
  })

  test("a short title is left alone", () => {
    expect(archiveSlug("Job Application")).toBe("job-application")
  })

  test("a title with no ASCII words still produces a usable name", () => {
    expect(archiveSlug("استمارة")).toBe("form")
  })

  test("a single long word is cut rather than dropped", () => {
    expect(archiveSlug("Supercalifragilisticexpialidociousapplication")).toBe(
      "supercalifragilisticexpialidocio",
    )
  })
})
