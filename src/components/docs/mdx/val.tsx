import { DOC_VALUES, isDocValueKey, type DocValueKey } from "@/lib/docs/values"

/**
 * A number in running prose, read from the code that owns it.
 *
 * `Reply 2xx within <Val name="webhook.timeoutSeconds" /> seconds.`
 *
 * The alternative — importing the policy constants into each `.mdx` — works,
 * but it puts an import statement at the top of every prose file and asks a
 * writer to know which module owns which number. This keeps the document
 * looking like a document.
 *
 * IT THROWS ON AN UNKNOWN KEY, and that is the point. MDX bodies are not
 * type-checked: `tsconfig.json` includes only .ts/.tsx/.mts, and `@types/mdx`
 * types the import rather than the file's contents. So a mistyped key has no
 * compile-time net. Throwing turns it into a build failure — loud, immediate,
 * and before anyone reads it — instead of a page that quietly renders nothing
 * where a number should be. `docs-content.test.ts` catches it earlier still.
 */
export function Val({ name }: { name: DocValueKey }) {
  if (!isDocValueKey(name)) {
    throw new Error(
      `<Val name="${name}"> is not a known documentation value. Add it to DOC_VALUES in src/lib/docs/values.ts, deriving it from the module that owns the number.`,
    )
  }
  return <>{DOC_VALUES[name]}</>
}
