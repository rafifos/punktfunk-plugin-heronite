// Milestone 1: the package loads as a library plugin and publishes nothing until the Heronite
// reader lands.

import { Effect } from "effect";
import { describe, expect, test } from "bun:test";

import runnerEntry from "../src/index.js";
import { pluginDef } from "../src/plugin.js";

describe("plugin scaffold", () => {
  test("the runner entry names the plugin", () => {
    expect(runnerEntry.name).toBe("heronite");
    expect(runnerEntry.main).toBeDefined();
  });

  test("the placeholder detects nothing and scans nothing", async () => {
    expect(await Effect.runPromise(pluginDef.detect())).toBe(false);
    expect(await Effect.runPromise(pluginDef.scan())).toEqual([]);
  });
});
