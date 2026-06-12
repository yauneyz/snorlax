/** Tiny classnames joiner (avoids pulling in clsx for a handful of components). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
