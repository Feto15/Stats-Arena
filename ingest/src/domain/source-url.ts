export const SOURCE_HOST = "hosted.dcd.shared.geniussports.com";
export const SOURCE_PREFIX = "/IBF/en";

export type SourceEntityKind = "competition" | "team" | "person" | "match";

export class SourceUrlError extends Error {
  constructor(message: string, readonly input: string) {
    super(message);
    this.name = "SourceUrlError";
  }
}

export function validateSourceUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SourceUrlError("URL sumber tidak valid.", input);
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== SOURCE_HOST) {
    throw new SourceUrlError(`URL harus memakai HTTPS pada ${SOURCE_HOST}.`, input);
  }
  if (!url.pathname.startsWith(`${SOURCE_PREFIX}/`)) {
    throw new SourceUrlError(`URL harus berada di bawah ${SOURCE_PREFIX}.`, input);
  }
  return url;
}

export function competitionUrl(input: string): URL {
  if (/^\d+$/.test(input.trim())) {
    const url = new URL(`${SOURCE_PREFIX}/competition/${input.trim()}`, `https://${SOURCE_HOST}`);
    return url;
  }
  const url = validateSourceUrl(input.trim());
  const match = url.pathname.match(/^\/IBF\/en\/competition\/(\d+)(?:\/|$)/);
  if (!match?.[1]) {
    throw new SourceUrlError("Input harus berupa ID atau URL halaman kompetisi.", input);
  }
  return new URL(`${SOURCE_PREFIX}/competition/${match[1]}`, url.origin);
}

export function sourceEntityId(input: string, kind: SourceEntityKind): string | null {
  let url: URL;
  try {
    url = new URL(input, `https://${SOURCE_HOST}`);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== SOURCE_HOST) return null;
  const patterns: Record<SourceEntityKind, RegExp> = {
    competition: /^\/IBF\/en\/competition\/(\d+)(?:\/|$)/,
    team: /^\/IBF\/en\/(?:competition\/\d+\/)?team\/(\d+)(?:\/|$)/,
    person: /^\/IBF\/en\/(?:competition\/\d+\/)?person\/(\d+)(?:\/|$)/,
    match: /^\/IBF\/en\/(?:competition\/\d+\/)?match\/(\d+)(?:\/|$)/
  };
  return patterns[kind].exec(url.pathname)?.[1] ?? null;
}

export function sourceUrlFor(competition: URL, suffix: string): string {
  const base = new URL(competition.href);
  base.pathname = `${base.pathname.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
  base.search = "";
  base.hash = "";
  return base.href;
}

export function groupSourceId(url: URL): { id: string; poolNumber: string | null } {
  const poolNumber = url.searchParams.get("poolNumber");
  const parts = [...url.searchParams.entries()].filter(([key]) => key !== "").sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  const query = new URLSearchParams(parts).toString();
  const path = url.pathname.replace(/\/$/, "").split("/").slice(-1)[0] ?? "standings";
  return { id: query ? `${path}?${query}` : path, poolNumber };
}
