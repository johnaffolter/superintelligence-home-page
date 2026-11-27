export function safeFeedReturn(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000) return "/";
  return value === "/" || value === "/saved" || value.startsWith("/?") ? value : "/";
}
