// Text and shape guards for Heronite's JSON. Plain helpers keep `heronite/*` free of the Effect
// runtime (docs/port-plan.md); `effect/Predicate` would be the same code with a dependency.

/** A trimmed non-empty string, or `undefined` for anything else. */
export function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** A plain JSON object: not `null`, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
