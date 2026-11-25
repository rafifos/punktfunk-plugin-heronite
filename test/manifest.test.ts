// The manifest the host reads. `ExecTemplate` has no environment field, so the transports that run
// Heronite carry their environment as an `env` prefix: a streamed game has to stay an X11 client, and
// Proton decides on `WAYLAND_DISPLAY`'s presence, which a manifest cannot express as an unset.

import { describe, expect, test } from "bun:test";

const manifest = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
  readonly punktfunk: {
    readonly exec: Record<
      string,
      { readonly exe: string; readonly args?: readonly string[]; readonly params?: object }
    >;
  };
};
const exec = manifest.punktfunk.exec;

/** Transports that start Heronite, so a game launched from them inherits this environment. */
const WRAPPED = [
  "run",
  "run-program",
  "run-flatpak",
  "window",
  "window-program",
  "window-flatpak",
  "console",
  "console-program",
  "console-flatpak",
];

describe("exec templates", () => {
  for (const name of WRAPPED) {
    test(`${name} turns Proton's Wayland driver off before the program`, () => {
      const template = exec[name];
      expect(template, name).toBeDefined();
      expect(template?.exe).toBe("env");
      expect(template?.args?.[0]).toBe("PROTON_ENABLE_WAYLAND=0");
      // `env` takes assignments first, then the command, so the program is the second argument.
      expect((template?.args?.[1] ?? "").startsWith("PROTON_")).toBe(false);
      expect(template?.args?.[1]?.length ?? 0).toBeGreaterThan(0);
    });
  }

  test("the protocol fallback stays a plain call", () => {
    // Documented as not streamable: xdg-open and explorer.exe hand the URL off and exit, so no
    // process is left to carry an environment.
    expect(exec.open?.exe).toBe("xdg-open");
    expect(exec["open-windows"]?.exe).toBe("explorer.exe");
  });

  test("every placeholder is backed by a declared param", () => {
    for (const [name, template] of Object.entries(exec)) {
      const declared = new Set(Object.keys(template.params ?? {}));
      for (const arg of template.args ?? []) {
        const placeholder = /^\{(\w+)\}$/.exec(arg)?.[1];
        if (placeholder !== undefined) {
          expect(declared, `${name}: {${placeholder}}`).toContain(placeholder);
        }
      }
    }
  });
});
