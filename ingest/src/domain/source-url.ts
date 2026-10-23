import { competitionReference, validateSourceUrl as validateSharedSourceUrl } from "@statsarena/db/source";
export { competitionReference, sourceNamespace, sourceName, sameSourceNamespace, sameCompetition } from "@statsarena/db/source";
export const SOURCE_HOST = "hosted.dcd.shared.geniussports.com";
export const SOURCE_PREFIX = "/IBF/en";
export const SUPPORTED_PREFIXES = ["/IBF/en", "/IBL/en"] as const;

export type SourceEntityKind = "competition" | "team" | "person" | "match";

export class SourceUrlError extends Error {
  constructor(message: string, readonly input: string) {
    super(message);
    this.name = "SourceUrlError";
  }
}

export function validateSourceUrl(input: string): URL {
  try { return validateSharedSourceUrl(input); }
  catch { throw new SourceUrlError("URL harus memakai HTTPS pada hosted.dcd.shared.geniussports.com di bawah /IBF/en atau /IBL/en tanpa kredensial/port.", input); }
}

export function competitionUrl(input: string): URL {
  try { return new URL(competitionReference(input).url); }
  catch { throw new SourceUrlError("Input harus berupa ID IBF, IBL:<ID>, atau URL halaman kompetisi.", input); }
}

export function sourceEntityId(input: string, kind: SourceEntityKind): string | null {
  let url: URL;
  try {
    url = new URL(input, `https://${SOURCE_HOST}`);
  } catch {
    return null;
  }
  try { validateSourceUrl(url.href); } catch { return null; }
  const patterns: Record<SourceEntityKind, RegExp> = {
    competition: /^\/(?:IBF|IBL)\/en\/competition\/(\d+)(?:\/|$)/,
    team: /^\/(?:IBF|IBL)\/en\/(?:competition\/\d+\/)?team\/(\d+)(?:\/|$)/,
    person: /^\/(?:IBF|IBL)\/en\/(?:competition\/\d+\/)?person\/(\d+)(?:\/|$)/,
    match: /^\/(?:IBF|IBL)\/en\/(?:competition\/\d+\/)?match\/(\d+)(?:\/|$)/
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
