// Launch transports, exec-template arguments and the two launcher tiles. The transport is chosen
// per install, never per game: every title asks Heronite itself to start the game (ADR-0001).

import { describe, expect, test } from "bun:test";

import {
  chooseTransport,
  gameLaunch,
  type LaunchEnvironment,
  launcherTiles,
  protocolUrl,
} from "../../src/heronite/launch.js";

const linux: LaunchEnvironment = {
  platform: "linux",
  onPath: () => false,
  exists: () => false,
};

const windows: LaunchEnvironment = { ...linux, platform: "win32" };

const programEnvironment: LaunchEnvironment = {
  platform: "linux",
  onPath: () => false,
  exists: (file) => file === "/opt/heronite/heronite-rs",
};

describe("chooseTransport", () => {
  test("a heronite-rs on PATH wins over the configured folder", () => {
    expect(
      chooseTransport(
        { programFolder: "/opt/heronite" },
        { platform: "linux", onPath: (command) => command === "heronite-rs", exists: () => true },
      ),
    ).toEqual({ kind: "run" });
  });

  test("a configured program folder uses run-program", () => {
    expect(chooseTransport({ programFolder: "/opt/heronite" }, programEnvironment)).toEqual({
      kind: "run-program",
      program: "/opt/heronite/heronite-rs",
    });
  });

  test("the program folder falls back to heronite-rs.exe then heronite.exe", () => {
    const onlyExe: LaunchEnvironment = {
      platform: "win32",
      onPath: () => false,
      exists: (file) => file === "C:\\Heronite\\heronite-rs.exe",
    };
    expect(chooseTransport({ programFolder: "C:\\Heronite" }, onlyExe)).toEqual({
      kind: "run-program",
      program: "C:\\Heronite\\heronite-rs.exe",
    });

    const portable: LaunchEnvironment = {
      platform: "win32",
      onPath: () => false,
      exists: (file) => file === "C:\\Heronite\\heronite.exe",
    };
    expect(chooseTransport({ programFolder: "C:\\Heronite" }, portable)).toEqual({
      kind: "run-program",
      program: "C:\\Heronite\\heronite.exe",
    });
  });

  test("an unverifiable configured folder still names heronite-rs", () => {
    expect(chooseTransport({ programFolder: "/opt/heronite" }, linux)).toEqual({
      kind: "run-program",
      program: "/opt/heronite/heronite-rs",
    });
  });

  test("a Flatpak data root uses run-flatpak", () => {
    expect(chooseTransport({ flatpak: true }, linux)).toEqual({ kind: "run-flatpak" });
  });

  test("otherwise Linux opens the protocol URL", () => {
    expect(chooseTransport({}, linux)).toEqual({ kind: "open", template: "open" });
  });

  test("otherwise Windows opens the protocol URL with explorer", () => {
    expect(chooseTransport({}, windows)).toEqual({ kind: "open", template: "open-windows" });
  });
});

describe("protocolUrl", () => {
  test("percent-encodes both values", () => {
    expect(protocolUrl("legendary", "My Game & More")).toBe(
      "heronite://launch?appName=My%20Game%20%26%20More&runner=legendary",
    );
  });
});

describe("gameLaunch", () => {
  const args = (runner: string, appName: string) => [
    { name: "runner", value: runner },
    { name: "appName", value: appName },
  ];

  test("run uses the manifest's --no-gui --launch template", () => {
    expect(gameLaunch({ kind: "run" }, "legendary", "ExampleEpicApp")).toEqual({
      kind: "exec",
      value: "run",
      args: args("legendary", "ExampleEpicApp"),
    });
  });

  test("run-program supplies the resolved program", () => {
    expect(
      gameLaunch(
        { kind: "run-program", program: "/opt/heronite/heronite-rs" },
        "gog",
        "1207658999",
      ),
    ).toEqual({
      kind: "exec",
      value: "run-program",
      args: [{ name: "program", value: "/opt/heronite/heronite-rs" }, ...args("gog", "1207658999")],
    });
  });

  test("run-flatpak keeps the flags in the template", () => {
    expect(gameLaunch({ kind: "run-flatpak" }, "nile", "amzn1.adg.product.Example")).toEqual({
      kind: "exec",
      value: "run-flatpak",
      args: args("nile", "amzn1.adg.product.Example"),
    });
  });

  test("the protocol fallback uses the platform's opener", () => {
    expect(gameLaunch({ kind: "open", template: "open" }, "sideload", "ExampleSideload")).toEqual({
      kind: "exec",
      value: "open",
      args: [
        {
          name: "url",
          value: "heronite://launch?appName=ExampleSideload&runner=sideload",
        },
      ],
    });

    expect(
      gameLaunch({ kind: "open", template: "open-windows" }, "sideload", "ExampleSideload"),
    ).toEqual({
      kind: "exec",
      value: "open-windows",
      args: [
        {
          name: "url",
          value: "heronite://launch?appName=ExampleSideload&runner=sideload",
        },
      ],
    });
  });

  test("a protocol URL of exactly 128 bytes is kept", () => {
    const appName = "a".repeat(86);
    const url = protocolUrl("sideload", appName);

    expect(new TextEncoder().encode(url)).toHaveLength(128);
    expect(gameLaunch({ kind: "open", template: "open" }, "sideload", appName)).toBeDefined();
  });

  test("a protocol URL over 128 bytes is dropped", () => {
    const appName = "a".repeat(87);
    const url = protocolUrl("sideload", appName);

    expect(new TextEncoder().encode(url)).toHaveLength(129);
    expect(gameLaunch({ kind: "open", template: "open" }, "sideload", appName)).toBeUndefined();
  });
});

describe("launcherTiles", () => {
  test("a PATH program yields the window and console tiles", () => {
    expect(launcherTiles({ kind: "run" })).toStrictEqual([
      {
        external_id: "launcher",
        title: "Heronite",
        role: "launcher",
        launch: { kind: "exec", value: "window" },
      },
      {
        external_id: "console",
        title: "Heronite Console",
        role: "launcher",
        launch: { kind: "exec", value: "console" },
      },
    ]);
  });

  test("a configured program folder supplies the program to both tiles", () => {
    expect(launcherTiles({ kind: "run-program", program: "/opt/heronite/heronite-rs" })).toEqual([
      {
        external_id: "launcher",
        title: "Heronite",
        role: "launcher",
        launch: {
          kind: "exec",
          value: "window-program",
          args: [{ name: "program", value: "/opt/heronite/heronite-rs" }],
        },
      },
      {
        external_id: "console",
        title: "Heronite Console",
        role: "launcher",
        launch: {
          kind: "exec",
          value: "console-program",
          args: [{ name: "program", value: "/opt/heronite/heronite-rs" }],
        },
      },
    ]);
  });

  test("a Flatpak install uses the Flatpak templates", () => {
    expect(launcherTiles({ kind: "run-flatpak" })).toEqual([
      {
        external_id: "launcher",
        title: "Heronite",
        role: "launcher",
        launch: { kind: "exec", value: "window-flatpak" },
      },
      {
        external_id: "console",
        title: "Heronite Console",
        role: "launcher",
        launch: { kind: "exec", value: "console-flatpak" },
      },
    ]);
  });

  test("the protocol fallback opens the window and has no console tile", () => {
    const tiles = launcherTiles({ kind: "open", template: "open" });

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toEqual({
      external_id: "launcher",
      title: "Heronite",
      role: "launcher",
      launch: {
        kind: "exec",
        value: "open",
        args: [{ name: "url", value: "heronite://" }],
      },
    });
  });

  test("the Windows protocol fallback uses explorer", () => {
    expect(launcherTiles({ kind: "open", template: "open-windows" })[0]?.launch).toEqual({
      kind: "exec",
      value: "open-windows",
      args: [{ name: "url", value: "heronite://" }],
    });
  });

  test("both tiles are toggleable and never carry an icon", () => {
    expect(launcherTiles({ kind: "run" }, { showLauncherTile: false })).toHaveLength(1);
    expect(launcherTiles({ kind: "run" }, { showConsoleTile: false })).toHaveLength(1);
    expect(
      launcherTiles({ kind: "run" }, { showLauncherTile: false, showConsoleTile: false }),
    ).toEqual([]);

    for (const tile of launcherTiles({ kind: "run" })) {
      expect(tile).not.toHaveProperty("icon");
    }
  });
});
