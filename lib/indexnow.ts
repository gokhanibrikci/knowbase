import { site } from "./site";

/**
 * IndexNow — tells participating engines a URL changed instead of waiting to be
 * recrawled. Bing, Yandex, Seznam and Naver share one submission; Google does not
 * participate.
 *
 * This matters more here than on an ordinary site: the corpus is small and every
 * entry carries a verification date that expires, so re-verified pages need to be
 * recrawled promptly or the freshness we publish stops matching what engines hold.
 *
 * The key is deliberately public — it only proves control of the domain, by being
 * served from public/<key>.txt at the site root.
 */
export const INDEXNOW_KEY = "20ad100837b75d3a5dbfa457d6f0e9a6";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** IndexNow accepts up to 10,000 URLs per request; we stay well under that. */
const MAX_URLS = 10_000;

export type SubmitResult = {
  status: number;
  ok: boolean;
  submitted: number;
  message: string;
};

function describe(status: number): string {
  switch (status) {
    case 200:
      return "accepted";
    case 202:
      return "accepted, key validation pending";
    case 400:
      return "bad request — malformed payload";
    case 403:
      return "key rejected — is the key file reachable at the site root?";
    case 422:
      return "URLs do not match the host, or key schema violated";
    case 429:
      return "rate limited";
    default:
      return `unexpected status ${status}`;
  }
}

export async function submitToIndexNow(urls: string[]): Promise<SubmitResult> {
  const host = new URL(site.url).host;

  const urlList = [...new Set(urls)].filter((u) => u.startsWith(site.url)).slice(0, MAX_URLS);

  if (urlList.length === 0) {
    return { status: 0, ok: false, submitted: 0, message: "no URLs on this host to submit" };
  }

  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host,
      key: INDEXNOW_KEY,
      keyLocation: `${site.url}/${INDEXNOW_KEY}.txt`,
      urlList,
    }),
  });

  return {
    status: res.status,
    ok: res.status === 200 || res.status === 202,
    submitted: urlList.length,
    message: describe(res.status),
  };
}
