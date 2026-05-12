import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  source: "exa" | "duckduckgo";
}

export interface WebFetchResult {
  url: string;
  finalUrl: string;
  title?: string;
  description?: string;
  contentType?: string;
  text: string;
}

const USER_AGENT = "Memoryhold/0.1 (+https://github.com/pithuene/memoryhold)";
const MAX_FETCH_BYTES = 2_000_000;
const MAX_FETCH_CHARS = 40_000;
const MAX_SEARCH_SNIPPET_CHARS = 400;

function truncate(text: string, maxChars: number): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}\n\n[Truncated at ${maxChars} characters.]` : normalized;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripHtml(html: string): string {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/?(p|div|section|article|main|header|footer|br|li|ul|ol|h[1-6]|blockquote|tr|table)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function htmlAttr(html: string, regex: RegExp): string | undefined {
  const match = html.match(regex)?.[1];
  return match ? decodeHtml(match.trim()) : undefined;
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http(s) URLs are supported");
  return parsed.toString();
}

async function fetchText(url: string, options: { maxBytes?: number } = {}): Promise<{ text: string; finalUrl: string; contentType?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.8,*/*;q=0.5" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const reader = response.body?.getReader();
    if (!reader) return { text: await response.text(), finalUrl: response.url, contentType: response.headers.get("content-type") ?? undefined };
    const chunks: Uint8Array[] = [];
    let total = 0;
    const maxBytes = options.maxBytes ?? MAX_FETCH_BYTES;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) break;
      chunks.push(value);
    }
    return { text: new TextDecoder().decode(Buffer.concat(chunks)), finalUrl: response.url, contentType: response.headers.get("content-type") ?? undefined };
  } finally {
    clearTimeout(timeout);
  }
}

async function exaSearch(query: string, numResults: number): Promise<WebSearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return [];
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query, numResults, useAutoprompt: true, type: "auto", contents: { text: { maxCharacters: MAX_SEARCH_SNIPPET_CHARS } } }),
  });
  if (!response.ok) throw new Error(`Exa search failed: HTTP ${response.status}`);
  const data = await response.json() as { results?: Array<{ title?: string; url?: string; text?: string; summary?: string }> };
  return (data.results ?? []).filter((r) => r.url).map((r) => ({
    title: r.title?.trim() || r.url!,
    url: r.url!,
    snippet: truncate(r.summary || r.text || "", MAX_SEARCH_SNIPPET_CHARS),
    source: "exa" as const,
  }));
}

function duckUrl(raw: string): string {
  const decoded = decodeHtml(raw);
  try {
    const parsed = new URL(decoded);
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : decoded;
  } catch {
    return decoded;
  }
}

async function duckDuckGoSearch(query: string, numResults: number): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { text: html } = await fetchText(url, { maxBytes: 800_000 });
  const results: WebSearchResult[] = [];
  const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const links = Array.from(html.matchAll(linkRegex));
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const href = duckUrl(link[1]);
    if (!href.startsWith("http")) continue;
    const nextIndex = links[i + 1]?.index ?? html.length;
    const block = html.slice(link.index ?? 0, nextIndex);
    const snippet = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1]
      ?? block.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      ?? "";
    results.push({ title: truncate(stripHtml(link[2]), 180), url: href, snippet: truncate(stripHtml(snippet), MAX_SEARCH_SNIPPET_CHARS), source: "duckduckgo" });
    if (results.length >= numResults) break;
  }
  return results;
}

export async function searchWeb(query: string, numResults = 5): Promise<WebSearchResult[]> {
  const limit = Math.max(1, Math.min(10, numResults));
  try {
    const exa = await exaSearch(query, limit);
    if (exa.length) return exa;
  } catch (error) {
    console.warn(error instanceof Error ? error.message : error);
  }
  return duckDuckGoSearch(query, limit);
}

export async function fetchWebPage(inputUrl: string): Promise<WebFetchResult> {
  const url = normalizeUrl(inputUrl);
  const { text: raw, finalUrl, contentType } = await fetchText(url);
  const isHtml = /html/i.test(contentType ?? "") || /<html|<body|<article|<main/i.test(raw.slice(0, 2000));
  const title = isHtml ? htmlAttr(raw, /<title[^>]*>([\s\S]*?)<\/title>/i) : undefined;
  const description = isHtml ? htmlAttr(raw, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) ?? htmlAttr(raw, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i) : undefined;
  const text = isHtml ? stripHtml(raw) : raw;
  return { url, finalUrl, title, description, contentType, text: truncate(text, MAX_FETCH_CHARS) };
}

export function createWebSearchTool(): AgentTool<any> {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web for current information. Uses Exa when EXA_API_KEY is configured, otherwise DuckDuckGo HTML.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      numResults: Type.Optional(Type.Number({ description: "Number of results to return, 1-10" })),
    }),
    async execute(_toolCallId, params) {
      const { query, numResults } = params as { query: string; numResults?: number };
      const results = await searchWeb(query, numResults ?? 5);
      return {
        content: [{ type: "text", text: results.length ? results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet ?? ""}`).join("\n\n") : `No results found for: ${query}` }],
        details: { query, results },
      };
    },
  };
}

export function createWebFetchTool(): AgentTool<any> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch a URL and extract readable page text for citation or analysis.",
    parameters: Type.Object({
      url: Type.String({ description: "http(s) URL to fetch" }),
    }),
    async execute(_toolCallId, params) {
      const { url } = params as { url: string };
      const page = await fetchWebPage(url);
      const header = [`URL: ${page.finalUrl}`, page.title ? `Title: ${page.title}` : "", page.description ? `Description: ${page.description}` : ""].filter(Boolean).join("\n");
      return {
        content: [{ type: "text", text: `${header}\n\n${page.text}`.trim() }],
        details: page,
      };
    },
  };
}
