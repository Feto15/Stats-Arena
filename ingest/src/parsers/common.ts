import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { IssueSeverity, ParseReport, ValidationIssue } from "../domain/types.js";
import { sourceEntityId, sameSourceNamespace } from "../domain/source-url.js";

export class ParserError extends Error {
  constructor(
    message: string,
    readonly sourceUrl: string,
    readonly selector: string
  ) {
    super(`${message} (URL: ${sourceUrl}; selector: ${selector})`);
    this.name = "ParserError";
  }
}

export function loadHtml(html: string, sourceUrl?: string): CheerioAPI {
  const $ = cheerio.load(html);
  if (sourceUrl) for (const anchor of $("a[href], option[value]").toArray()) {
    const attr = anchor.tagName === "option" ? "value" : "href";
    const href = $(anchor).attr(attr);
    try { if (href && !sameSourceNamespace(new URL(href, sourceUrl).href, sourceUrl)) $(anchor).removeAttr(attr); }
    catch { $(anchor).removeAttr(attr); }
  }
  return $;
}

export function requiredSelection<T extends AnyNode>(
  $: CheerioAPI,
  selector: string,
  sourceUrl: string
): Cheerio<T> {
  const selected = $(selector) as Cheerio<T>;
  if (selected.length === 0) {
    throw new ParserError("Selector wajib tidak ditemukan", sourceUrl, selector);
  }
  return selected;
}

export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function textOf($: CheerioAPI, element: AnyNode, selectors: string[]): string | null {
  for (const selector of selectors) {
    const found = $(element).find(selector).first();
    const text = cleanText(found.text());
    if (text) return text;
  }
  return null;
}

export function attrOf($: CheerioAPI, element: AnyNode, attr: string): string | null {
  const value = $(element).attr(attr);
  return value?.trim() || null;
}

export function issue(
  severity: IssueSeverity,
  code: string,
  message: string,
  sourceUrl: string,
  fieldPath: string | null = null,
  expected: unknown = null,
  actual: unknown = null
): ValidationIssue {
  return { severity, code, message, sourceUrl, fieldPath, expected, actual };
}

export function report<T>(
  sourceUrl: string,
  records: T[],
  issues: ValidationIssue[]
): ParseReport<T> {
  return {
    status: issues.some((entry) => entry.severity === "error") ? "partial" : "parsed",
    sourceUrl,
    records,
    issues
  };
}

export function idFromElementLink(
  $: CheerioAPI,
  element: AnyNode,
  kind: "competition" | "team" | "person" | "match"
): string | null {
  const ownHref = $(element).attr("href");
  const ownId = ownHref ? sourceEntityId(ownHref, kind) : null;
  if (ownId) return ownId;
  for (const anchor of $(element).find("a[href]").toArray()) {
    const href = $(anchor).attr("href");
    const id = href ? sourceEntityId(href, kind) : null;
    if (id) return id;
  }
  return null;
}

export function absoluteSourceUrl(sourceUrl: string, href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const value = new URL(href, sourceUrl);
    return sameSourceNamespace(value.href, sourceUrl) ? value.href : null;
  } catch {
    return null;
  }
}

export function integerValue(value: string | null | undefined): number | null {
  const raw = cleanText(value);
  if (!raw || /^(?:-|–|—|n\/a)$/i.test(raw)) return null;
  const number = Number(raw.replace(/,/g, "").replace(/%$/, ""));
  return Number.isSafeInteger(number) ? number : null;
}

export function nullableInteger(value: string | null | undefined): number | null {
  return integerValue(value);
}

export function normalizedHeader(value: string): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9%]+/g, "")
    .replace(/PTS$/, "PTS");
}

export function selectorText($: CheerioAPI, element: AnyNode, selectors: string[]): string | null {
  return textOf($, element, selectors);
}
