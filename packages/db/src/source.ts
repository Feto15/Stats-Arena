export const SOURCE_HOST = "hosted.dcd.shared.geniussports.com";
export const SOURCE_NAMES = { IBF: "genius_sports", IBL: "genius_sports:IBL" } as const;
export type SourceNamespace = keyof typeof SOURCE_NAMES;

export function validateSourceUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname !== SOURCE_HOST || url.username || url.password || url.port ||
      !/^\/(?:IBF|IBL)\/en(?:\/|$)/.test(url.pathname)) throw new Error("URL sumber harus HTTPS Genius Sports pada namespace IBF atau IBL.");
  return url;
}

export function sourceNamespace(input: string): SourceNamespace {
  return validateSourceUrl(input).pathname.startsWith("/IBL/en") ? "IBL" : "IBF";
}

export function sourceName(input: string): typeof SOURCE_NAMES[SourceNamespace] {
  return SOURCE_NAMES[sourceNamespace(input)];
}

/** Numeric references retain the original IBF meaning. IBL is always explicit. */
export function competitionReference(input: string) {
  const value = input.trim();
  const short = /^(?:(IBF|IBL):)?(\d{1,32})$/.exec(value);
  const url = short ? new URL(`https://${SOURCE_HOST}/${short[1] ?? "IBF"}/en/competition/${short[2]}`) : validateSourceUrl(value);
  const id = /^\/(?:IBF|IBL)\/en\/competition\/(\d{1,32})(?:\/|$)/.exec(url.pathname)?.[1];
  if (!id) throw new Error("Referensi kompetisi harus ID IBF, IBL:<ID>, atau URL kompetisi.");
  const namespace = sourceNamespace(url.href);
  const key = namespace === "IBF" ? id : `IBL:${id}`;
  return { id, namespace, key, source: SOURCE_NAMES[namespace], url: `https://${SOURCE_HOST}/${namespace}/en/competition/${id}` };
}

export function sameSourceNamespace(first: string, second: string): boolean {
  try { return sourceNamespace(first) === sourceNamespace(second); } catch { return false; }
}

export function sameCompetition(first: string, second: string): boolean {
  try { return competitionReference(first).key === competitionReference(second).key; } catch { return false; }
}
