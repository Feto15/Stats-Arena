import { SOURCE_HOST, sourceEntityId, validateSourceUrl } from "../domain/source-url.js";

export const MAX_TARGETED_RETRY_URLS = 25;

function supportedRetryPage(url: URL): boolean {
  return /^\/IBF\/en\/competition\/\d+(?:\/(?:teams|players|standings|schedule))?\/?$/.test(url.pathname) ||
    /^\/IBF\/en\/competition\/\d+\/statistics\/team\/?$/.test(url.pathname) ||
    /^\/IBF\/en\/(?:competition\/\d+\/)?match\/\d+\/(?:summary|boxscore|playbyplay|shotchart|analysis)\/?$/.test(url.pathname);
}

export function targetedRetryUrls(audit: unknown, sourceCompetitionId: string, maxUrls = MAX_TARGETED_RETRY_URLS): string[] {
  if (typeof audit !== "object" || audit === null) throw new Error("Audit retry harus berupa objek JSON.");
  const value = audit as { fetches?: unknown; issues?: unknown };
  const candidates = new Set<string>();
  if (Array.isArray(value.fetches)) {
    for (const item of value.fetches) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as { requestUrl?: unknown; fetchStatus?: unknown; parseStatus?: unknown };
      if (typeof record.requestUrl !== "string") continue;
      if (record.fetchStatus !== "failed" && record.parseStatus !== "failed" && record.parseStatus !== "partial") continue;
      candidates.add(record.requestUrl);
    }
  }
  if (Array.isArray(value.issues)) {
    for (const item of value.issues) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as { sourceUrl?: unknown; severity?: unknown };
      if (typeof record.sourceUrl !== "string" || (record.severity !== "error" && record.severity !== "warning")) continue;
      candidates.add(record.sourceUrl);
    }
  }
  const valid = new Set<string>();
  for (const candidate of candidates) {
    let url: URL;
    try { url = validateSourceUrl(candidate); } catch { continue; }
    if (url.hostname !== SOURCE_HOST || !supportedRetryPage(url)) continue;
    if (sourceEntityId(url.href, "competition") !== sourceCompetitionId) continue;
    url.hash = "";
    valid.add(url.href);
  }
  const results = [...valid];
  if (results.length > maxUrls) {
    throw new Error(`Audit memuat ${results.length} halaman gagal/parsial; retry dibatasi ${maxUrls} URL per perintah.`);
  }
  if (results.length === 0) throw new Error("Audit tidak memuat URL gagal atau parsial yang valid untuk kompetisi ini.");
  return results;
}
