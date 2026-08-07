import type { KnowledgeObject } from "./schema";

/**
 * Deliberately small: a term-frequency match over the fields a person actually
 * pastes into a search box. The corpus is measured in dozens, not millions, and a
 * real index would be dishonest complexity at this size.
 */
function haystack(ko: KnowledgeObject) {
  return {
    signature: [ko.error.signature, ...ko.error.codes, ...ko.error.aliases].join(" ").toLowerCase(),
    title: ko.title.toLowerCase(),
    tags: ko.tags.join(" ").toLowerCase(),
    body: [
      ko.summary,
      ko.problem,
      ...ko.rootCauses.map((c) => `${c.cause} ${c.detail ?? ""}`),
      ...ko.appliesTo.technology.map((t) => t.name),
    ]
      .join(" ")
      .toLowerCase(),
  };
}

export function searchKnowledgeObjects(
  objects: KnowledgeObject[],
  query: string,
): KnowledgeObject[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return objects;

  const scored = objects
    .map((ko) => {
      const fields = haystack(ko);
      let score = 0;

      for (const term of terms) {
        // An exact error-string hit is worth more than a passing mention in prose.
        if (fields.signature.includes(term)) score += 8;
        if (fields.title.includes(term)) score += 5;
        if (fields.tags.includes(term)) score += 3;
        if (fields.body.includes(term)) score += 1;
      }

      return { ko, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.ko.title.localeCompare(b.ko.title));

  return scored.map((r) => r.ko);
}
