// One identity rule, four shapes: the provider external id (`runner:appName`), the same string
// split back apart, Heronite's metadata key (Zoom stored under `sideload`) and its in-memory
// Collection key (`runner_appName`). Every module imports these instead of rebuilding them.

import { describe, expect, test } from "bun:test";

import {
  collectionKey,
  entryId,
  metadataKey,
  parseCollectionKey,
  parseEntryId,
} from "../../src/heronite/identity.js";

describe("entryId", () => {
  test("joins a runner and app name with a colon", () => {
    expect(entryId("nile", "amzn1.adg.product.Example")).toBe("nile:amzn1.adg.product.Example");
    expect(entryId("sideload", "ExampleSideload")).toBe("sideload:ExampleSideload");
  });
});

describe("parseEntryId", () => {
  test("splits the external id at its first colon", () => {
    expect(parseEntryId("sideload:ExampleSideload")).toEqual({
      runner: "sideload",
      appName: "ExampleSideload",
    });
    expect(parseEntryId("legendary:Calluna")).toEqual({
      runner: "legendary",
      appName: "Calluna",
    });
  });

  test("an app name may contain colons; the runner may not", () => {
    expect(parseEntryId("nile:amzn1.adg.product:Example")).toEqual({
      runner: "nile",
      appName: "amzn1.adg.product:Example",
    });
  });

  test("a missing colon or an empty half is not an id", () => {
    expect(parseEntryId("")).toBeUndefined();
    expect(parseEntryId("sideload")).toBeUndefined();
    expect(parseEntryId(":ExampleSideload")).toBeUndefined();
    expect(parseEntryId("sideload:")).toBeUndefined();
  });
});

describe("collectionKey", () => {
  test("joins a runner and app name with an underscore", () => {
    expect(collectionKey("gog", "1207658999")).toBe("gog_1207658999");
    expect(collectionKey("sideload", "emu_9f2c1a77b3d84e10")).toBe("sideload_emu_9f2c1a77b3d84e10");
  });

  test("splits at the runner's first underscore, keeping the app name's own", () => {
    expect(parseCollectionKey("sideload_emu_9f2c1a77b3d84e10")).toEqual({
      runner: "sideload",
      appName: "emu_9f2c1a77b3d84e10",
    });
  });

  test("a key without a non-empty runner and app name is not a Collection key", () => {
    expect(parseCollectionKey("")).toBeUndefined();
    expect(parseCollectionKey("sideload")).toBeUndefined();
    expect(parseCollectionKey("_ExampleSideload")).toBeUndefined();
    expect(parseCollectionKey("sideload_")).toBeUndefined();
  });

  test("round-trips through its parse", () => {
    const key = collectionKey("legendary", "ExampleEpicApp");
    expect(parseCollectionKey(key)).toEqual({ runner: "legendary", appName: "ExampleEpicApp" });
  });
});

describe("metadataKey", () => {
  test("is the external id shape, with Zoom stored under sideload", () => {
    expect(metadataKey("legendary", "ExampleEpicApp")).toBe("legendary:ExampleEpicApp");
    expect(metadataKey("zoom", "1234567890")).toBe("sideload:1234567890");
  });
});
