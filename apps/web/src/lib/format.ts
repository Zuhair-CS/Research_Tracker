/** Returns up to two uppercase initials for user/researcher avatar badges. */
export function initialsOf(name: string, fallback = 'U'): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? fallback).toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}
