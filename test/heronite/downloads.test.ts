// Downloads: what `store/download-manager.json` says, how its queue and history become download
// rows, and which rows are news. Every case runs against the fixture tree or a throwaway root,
// never against a real Heronite.

import type { DownloadRow } from "@punktfunk/plugin-kit";
import type { DownloadElement } from "../../src/heronite/model.js";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  type DownloadSnapshot,
  downloadChanges,
  downloadId,
  downloadRows,
  makeDownloadMemory,
  readDownloads,
} from "../../src/heronite/downloads.js";

const fixtures = join(import.meta.dir, "..", "fixtures");
const root = join(fixtures, "heronite-data");
const pausedRoot = join(fixtures, "heronite-data-paused");

const tempRoots: string[] = [];

function tempRoot(files: Readonly<Record<string, string | object>>): string {
  const dir = mkdtempSync(join(tmpdir(), "heronite-downloads-"));
  tempRoots.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const file = join(dir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function snapshotOf(dir: string): DownloadSnapshot {
  const snapshot = readDownloads(dir);
  if (snapshot === undefined) throw new Error(`no download snapshot in ${dir}`);
  return snapshot;
}

function element(
  runner: string,
  appName: string,
  extra: Partial<DownloadElement> = {},
): DownloadElement {
  return { params: { runner, appName }, ...extra };
}

describe("readDownloads", () => {
  test("reads the fixture's running queue, its history and the user pause flag", () => {
    const snapshot = readDownloads(root);

    expect(snapshot?.queue.map((element) => element.params?.appName)).toEqual([
      "amzn1.adg.product.Example",
      "ExampleEpicAppDlc",
    ]);
    expect(snapshot?.finished.map((element) => element.params?.appName)).toEqual([
      "ExampleFailedEpicApp",
    ]);
    expect(snapshot?.userPaused).toBe(false);
  });

  test("the paused fixture says the user holds the queue", () => {
    expect(readDownloads(pausedRoot)?.userPaused).toBe(true);
  });

  test("a missing or malformed file is undefined, never an empty queue", () => {
    expect(readDownloads(tempRoot({}))).toBeUndefined();
    expect(readDownloads(tempRoot({ "store/download-manager.json": "{not json" }))).toBeUndefined();
  });

  test("a file with neither queue nor history reads as an empty snapshot", () => {
    const snapshot = readDownloads(tempRoot({ "store/download-manager.json": {} }));

    expect(snapshot).toEqual({ queue: [], finished: [], userPaused: false });
  });
});

describe("downloadId", () => {
  test("uses the params runner and app name as the entry's external id", () => {
    expect(
      downloadId({ params: { runner: "nile", appName: "amzn1.adg.product.Example" } }),
    ).toEqual({
      runner: "nile",
      appName: "amzn1.adg.product.Example",
      externalId: "nile:amzn1.adg.product.Example",
    });
  });

  test("an element missing either half is skipped", () => {
    expect(downloadId({ params: { runner: "nile" } })).toBeUndefined();
    expect(downloadId({ params: { appName: "ExampleGame" } })).toBeUndefined();
    expect(downloadId({ params: { runner: "", appName: "ExampleGame" } })).toBeUndefined();
    expect(downloadId({})).toBeUndefined();
  });
});

describe("downloadRows", () => {
  test("the running queue head downloads and the tail waits, in file order", () => {
    const rows = [...downloadRows(snapshotOf(root))];

    expect(rows).toEqual([
      [
        "nile:amzn1.adg.product.Example",
        {
          externalId: "nile:amzn1.adg.product.Example",
          state: "downloading",
          doneBytes: 0,
          totalBytes: 13_421_772_800,
        },
      ],
      [
        "legendary:ExampleEpicAppDlc",
        {
          externalId: "legendary:ExampleEpicAppDlc",
          state: "queued",
          doneBytes: 0,
          totalBytes: 1_610_612_736,
        },
      ],
      [
        "legendary:ExampleFailedEpicApp",
        {
          externalId: "legendary:ExampleFailedEpicApp",
          state: "failed",
          doneBytes: 0,
          totalBytes: 8_589_934_592,
          error: "Example failure: disk full",
        },
      ],
    ]);
  });

  test("a user pause makes the queue head paused, not downloading", () => {
    const rows = downloadRows(snapshotOf(pausedRoot));

    expect(rows.get("nile:amzn1.adg.product.Example")).toEqual({
      externalId: "nile:amzn1.adg.product.Example",
      state: "paused",
      doneBytes: 0,
      totalBytes: 13_421_772_800,
      phase: "Paused in Heronite",
    });
  });

  test("a finished install is done and reports its own size as done", () => {
    const rows = downloadRows({
      queue: [],
      finished: [
        {
          ...element("legendary", "ExampleDone", { status: "done" }),
          params: { runner: "legendary", appName: "ExampleDone", size: "25.87 GiB" },
        },
      ],
      userPaused: false,
    });

    expect(rows.get("legendary:ExampleDone")).toEqual({
      externalId: "legendary:ExampleDone",
      state: "done",
      doneBytes: 27_777_700_987,
      totalBytes: 27_777_700_987,
    });
  });

  test("a done install without a parseable size stays at zero bytes", () => {
    const rows = downloadRows({
      queue: [],
      finished: [
        {
          ...element("legendary", "ExampleDone", { status: "done" }),
          params: { runner: "legendary", appName: "ExampleDone", size: "a lot" },
        },
      ],
      userPaused: false,
    });

    expect(rows.get("legendary:ExampleDone")).toEqual({
      externalId: "legendary:ExampleDone",
      state: "done",
      doneBytes: 0,
    });
  });

  test("a failed install carries Heronite's error", () => {
    const rows = downloadRows(snapshotOf(root));

    expect(rows.get("legendary:ExampleFailedEpicApp")).toEqual({
      externalId: "legendary:ExampleFailedEpicApp",
      state: "failed",
      doneBytes: 0,
      totalBytes: 8_589_934_592,
      error: "Example failure: disk full",
    });
  });

  test("a failed install without a message still names Heronite", () => {
    const rows = downloadRows({
      queue: [],
      finished: [element("legendary", "ExampleBroken", { status: "error" })],
      userPaused: false,
    });
    const row = rows.get("legendary:ExampleBroken");

    expect(row?.state).toBe("failed");
    expect(row?.error).toContain("Heronite");
  });

  test("an aborted install is cancelled", () => {
    const rows = downloadRows({
      queue: [],
      finished: [element("gog", "1207658999", { status: "abort" })],
      userPaused: false,
    });

    expect(rows.get("gog:1207658999")?.state).toBe("cancelled");
  });

  test("a finished element with a missing or unknown status is skipped", () => {
    const rows = downloadRows({
      queue: [],
      finished: [
        element("legendary", "ExampleNoStatus"),
        element("legendary", "ExampleWeirdStatus", { status: "paused" }),
      ],
      userPaused: false,
    });

    expect(rows.size).toBe(0);
  });

  test("elements without both a runner and an app name are skipped everywhere", () => {
    const rows = downloadRows({
      queue: [{ params: { runner: "legendary" } }, { params: { appName: "ExampleGame" } }],
      finished: [{ params: { runner: "gog" }, status: "done" }],
      userPaused: false,
    });

    expect(rows.size).toBe(0);
  });

  test("a title in both the queue and the history is decided by the queue", () => {
    const rows = downloadRows({
      queue: [element("legendary", "ExampleBoth")],
      finished: [element("legendary", "ExampleBoth", { status: "done" })],
      userPaused: false,
    });

    expect(rows.size).toBe(1);
    expect(rows.get("legendary:ExampleBoth")).toEqual({
      externalId: "legendary:ExampleBoth",
      state: "downloading",
      doneBytes: 0,
    });
  });

  test("a stored size that is not text is ignored instead of crashing the read", () => {
    const dir = tempRoot({
      "store/download-manager.json": {
        queue: [{ params: { runner: "nile", appName: "ExampleNumericSize", size: 42 } }],
      },
    });
    const row = downloadRows(snapshotOf(dir)).get("nile:ExampleNumericSize");

    expect(row?.state).toBe("downloading");
    expect(row?.totalBytes).toBeUndefined();
  });

  test("the stored size text becomes total bytes when it parses, and nothing when it does not", () => {
    const cases: ReadonlyArray<readonly [string, number | undefined]> = [
      ["12.5 GiB", 13_421_772_800],
      ["1.5 GiB", 1_610_612_736],
      ["25.87 GiB", 27_777_700_987],
      ["8.0 GiB", 8_589_934_592],
      ["a lot", undefined],
    ];

    for (const [size, expected] of cases) {
      const rows = downloadRows({
        queue: [
          {
            ...element("legendary", "ExampleSized"),
            params: { runner: "legendary", appName: "ExampleSized", size },
          },
        ],
        finished: [],
        userPaused: false,
      });
      const row = rows.get("legendary:ExampleSized");

      expect(row?.totalBytes).toBe(expected);
      expect(row?.doneBytes).toBe(0);
    }
  });
});

describe("downloadChanges", () => {
  function row(
    externalId: string,
    state: DownloadRow["state"],
    extra: Partial<DownloadRow> = {},
  ): DownloadRow {
    return { externalId, state, doneBytes: 0, ...extra };
  }

  function rowsOf(...rows: DownloadRow[]): Map<string, DownloadRow> {
    return new Map(rows.map((sent) => [sent.externalId, sent]));
  }

  test("the first read sends the live rows and none of the history", () => {
    const memory = makeDownloadMemory();
    const changes = downloadChanges(
      rowsOf(
        row("nile:ExampleDownloading", "downloading"),
        row("legendary:ExampleQueued", "queued"),
        row("legendary:ExampleDone", "done"),
        row("legendary:ExampleFailed", "failed", { error: "Heronite stopped it." }),
        row("gog:ExampleCancelled", "cancelled"),
      ),
      memory,
    );

    expect(changes.map((sent) => [sent.externalId, sent.state])).toEqual([
      ["nile:ExampleDownloading", "downloading"],
      ["legendary:ExampleQueued", "queued"],
    ]);
  });

  test("an unchanged second read sends nothing", () => {
    const memory = makeDownloadMemory();
    const rows = rowsOf(
      row("nile:ExampleDownloading", "downloading"),
      row("gog:Example", "queued"),
    );

    downloadChanges(rows, memory);

    expect(downloadChanges(rows, memory)).toEqual([]);
  });

  test("a queued title moving to the queue head is sent once", () => {
    const memory = makeDownloadMemory();
    downloadChanges(rowsOf(row("legendary:ExampleQueued", "queued")), memory);

    const changes = downloadChanges(rowsOf(row("legendary:ExampleQueued", "downloading")), memory);

    expect(changes).toEqual([row("legendary:ExampleQueued", "downloading")]);
    expect(downloadChanges(rowsOf(row("legendary:ExampleQueued", "downloading")), memory)).toEqual(
      [],
    );
  });

  test("a download finishing sends exactly one terminal row", () => {
    const memory = makeDownloadMemory();
    downloadChanges(rowsOf(row("nile:Example", "downloading")), memory);

    const done = row("nile:Example", "done", { doneBytes: 1000, totalBytes: 1000 });
    expect(downloadChanges(rowsOf(done), memory)).toEqual([done]);
    expect(downloadChanges(rowsOf(done), memory)).toEqual([]);
    expect(downloadChanges(rowsOf(done), memory)).toEqual([]);
  });

  test("a live row that vanishes sends one cancelled row, then is forgotten", () => {
    const memory = makeDownloadMemory();
    downloadChanges(rowsOf(row("nile:Example", "downloading")), memory);

    const cancelled = downloadChanges(new Map(), memory);
    expect(cancelled.map((sent) => [sent.externalId, sent.state])).toEqual([
      ["nile:Example", "cancelled"],
    ]);
    expect(downloadChanges(new Map(), memory)).toEqual([]);
  });

  test("a terminal row that vanishes sends nothing", () => {
    const memory = makeDownloadMemory();
    downloadChanges(rowsOf(row("nile:Example", "downloading")), memory);
    downloadChanges(rowsOf(row("nile:Example", "done")), memory);

    expect(downloadChanges(new Map(), memory)).toEqual([]);
    expect(downloadChanges(new Map(), memory)).toEqual([]);
  });

  test("history that is already on disk at the first read never becomes news", () => {
    const memory = makeDownloadMemory();
    const history = rowsOf(row("legendary:ExampleHistory", "done"));

    expect(downloadChanges(history, memory)).toEqual([]);
    expect(downloadChanges(new Map(), memory)).toEqual([]);
  });

  test("a terminal row is never replaced by a different terminal row", () => {
    const memory = makeDownloadMemory();
    downloadChanges(rowsOf(row("nile:Example", "downloading")), memory);
    downloadChanges(rowsOf(row("nile:Example", "failed")), memory);

    expect(downloadChanges(rowsOf(row("nile:Example", "done")), memory)).toEqual([]);
  });

  test("an installing row is sent on first sight", () => {
    const memory = makeDownloadMemory();

    expect(downloadChanges(rowsOf(row("nile:Example", "installing")), memory)).toEqual([
      row("nile:Example", "installing"),
    ]);
  });

  test("a user-paused row is sent once, then only when it changes", () => {
    const memory = makeDownloadMemory();
    const paused = row("nile:Example", "paused", { phase: "Paused in Heronite" });

    expect(downloadChanges(rowsOf(paused), memory)).toEqual([paused]);
    expect(downloadChanges(rowsOf(paused), memory)).toEqual([]);
    expect(downloadChanges(rowsOf(row("nile:Example", "downloading")), memory)).toEqual([
      row("nile:Example", "downloading"),
    ]);
  });
});
