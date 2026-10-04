export const fail = (message: string): never => {
  throw new Error(message);
};
export const record = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail(`${field} must be an object.`);
  return value as Record<string, unknown>;
};
export const fields = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail(`Unsupported field in ${field}. Supported: ${allowed.join(", ")}.`);
};
