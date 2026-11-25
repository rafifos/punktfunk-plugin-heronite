// Text guards for Heronite's JSON. `heronite/*` takes no Effect service or runtime
// (docs/adr/0007-pure-decode-layer-injected-io.md), but the guards themselves come from
// `effect/Predicate`: writing them by hand is what the Effect guide forbids, and the Predicate
// module is a plain dependency, not a service.

import { Predicate } from "effect";

/** A trimmed non-empty string, or `undefined` for anything else. */
export function nonEmpty(value: unknown): string | undefined {
  return Predicate.isString(value) && value.trim() !== "" ? value : undefined;
}

export const { isNumber } = Predicate;
