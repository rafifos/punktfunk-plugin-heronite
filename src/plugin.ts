// The plugin's definition. Milestone 1 placeholder: it detects and scans nothing until the
// Heronite reader lands.
import { defineLibraryPlugin } from "@punktfunk/plugin-kit/library";
import { Effect, Schema } from "effect";

export const pluginDef = {
  name: "heronite",
  title: "Heronite",
  configSchema: Schema.Struct({}),

  detect: () => Effect.succeed(false),
  scan: () => Effect.succeed([]),
};

export const plugin = defineLibraryPlugin(pluginDef);
