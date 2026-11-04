export function sanitizeOptionalString(value) {
  if (typeof value !== 'string') return value;
  return value.trim() || null;
}
