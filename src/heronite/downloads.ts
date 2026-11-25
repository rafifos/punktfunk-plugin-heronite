// The download queue Heronite persists: which titles it is fetching, which finished, and the
// size text it wrote. The file records transitions only, so rows carry no percentage, speed or
// ETA (see the README); it is read tolerantly and never crashes the loop.

import type { DownloadRow, DownloadState } from "@punktfunk/plugin-kit";
import type { DownloadElement } from "./model.js";

import { Predicate } from "effect";

import { readStore } from "./json.js";
import { parseDisplaySize } from "./library.js";
import { dataPaths } from "./paths.js";

/** What `store/download-manager.json` says, with Heronite's omissions already defaulted. */
interface DownloadSnapshot {
  readonly queue: readonly DownloadElement[];
  readonly finished: readonly DownloadElement[];
  readonly userPaused: boolean;
}

/** Heronite's identity for one queued download, and the provider entry it belongs to. */
interface DownloadId {
  readonly runner: string;
  readonly appName: string;
  /** `<runner>:<appName>`, the provider entry's external id (ADR-0004). */
  readonly externalId: string;
}

/** Heronite's last sent rows, keyed by external id; `plugin.ts` owns one per process. */
type DownloadMemory = Map<string, DownloadRow>;

function nonEmpty(value: unknown): string | undefined {
  return Predicate.isString(value) && value.trim() !== "" ? value : undefined;
}

/** The queue or history array, dropping entries that are not objects at all. */
function elements(value: unknown): readonly DownloadElement[] {
  if (!Array.isArray(value)) return [];
  return value.filter(Predicate.isObject) as readonly DownloadElement[];
}

/** A failed download Heronite did not explain still gets a sentence for the player. */
const UNEXPLAINED_FAILURE = "Heronite stopped this download before it finished.";

/** The size text Heronite stored, parsed when it names a known unit. */
function totalBytes(element: DownloadElement): number | undefined {
  const size = nonEmpty(element.params?.size);
  return size === undefined ? undefined : parseDisplaySize(size);
}

/** The history's terminal status as a host state, or `undefined` for a row with no status. */
function finishedState(status: DownloadElement["status"]): DownloadState | undefined {
  switch (status) {
    case "done":
      return "done";
    case "error":
      return "failed";
    case "abort":
      return "cancelled";
    default:
      return undefined;
  }
}

function isTerminal(state: DownloadState): boolean {
  return state === "done" || state === "failed" || state === "cancelled";
}

function sameRow(left: DownloadRow, right: DownloadRow): boolean {
  return (
    left.state === right.state &&
    left.doneBytes === right.doneBytes &&
    left.totalBytes === right.totalBytes &&
    left.phase === right.phase &&
    left.error === right.error
  );
}

/** Reads the queue and history; absent, malformed or non-object files are `undefined`. */
export function readDownloads(dataRoot: string): DownloadSnapshot | undefined {
  const file = readStore<unknown>(dataPaths(dataRoot).downloadManager);
  if (!Predicate.isObject(file)) return undefined;

  return {
    queue: elements(file.queue),
    finished: elements(file.finished),
    userPaused: file.userPaused === true,
  };
}

/** The runner and app name a queue element names, or `undefined` when either is missing. */
export function downloadId(element: DownloadElement): DownloadId | undefined {
  const runner = nonEmpty(element.params?.runner);
  const appName = nonEmpty(element.params?.appName);
  if (runner === undefined || appName === undefined) return undefined;

  return { runner, appName, externalId: `${runner}:${appName}` };
}

/** A fresh memory for {@link downloadChanges}. */
export function makeDownloadMemory(): DownloadMemory {
  return new Map();
}

/**
 * Maps the persisted queue and history to download rows. The queue wins over a history row for the
 * same title: a re-queued game is live again while its old result is still on disk. Nothing but a
 * `done` row reports progress, because Heronite persists no progress.
 */
export function downloadRows(snapshot: DownloadSnapshot): Map<string, DownloadRow> {
  const rows = new Map<string, DownloadRow>();

  snapshot.queue.forEach((element, index) => {
    const id = downloadId(element);
    if (id === undefined || rows.has(id.externalId)) return;

    const total = totalBytes(element);
    const paused = index === 0 && snapshot.userPaused;
    rows.set(id.externalId, {
      externalId: id.externalId,
      state: index === 0 ? (paused ? "paused" : "downloading") : "queued",
      doneBytes: 0,
      ...(total === undefined ? {} : { totalBytes: total }),
      ...(paused ? { phase: "Paused in Heronite" } : {}),
    });
  });

  for (const element of snapshot.finished) {
    const id = downloadId(element);
    if (id === undefined || rows.has(id.externalId)) continue;

    const state = finishedState(element.status);
    if (state === undefined) continue;

    const total = totalBytes(element);
    rows.set(id.externalId, {
      externalId: id.externalId,
      state,
      doneBytes: state === "done" ? (total ?? 0) : 0,
      ...(total === undefined ? {} : { totalBytes: total }),
      ...(state === "failed" ? { error: nonEmpty(element.error) ?? UNEXPLAINED_FAILURE } : {}),
    });
  }

  return rows;
}

/**
 * Which rows are news since the last send. A row is sent when it first appears or changes, unless
 * it is terminal: history already on disk is not news. A terminal row is sent once, when it
 * replaces a row that was not terminal, and never again. A title that left the file while it was
 * not terminal is reported cancelled once.
 */
export function downloadChanges(
  rows: Map<string, DownloadRow>,
  memory: DownloadMemory,
): DownloadRow[] {
  const changes: DownloadRow[] = [];
  const present = new Set<string>();

  for (const [externalId, row] of rows) {
    present.add(externalId);
    const last = memory.get(externalId);

    if (last === undefined) {
      if (isTerminal(row.state)) continue;
      changes.push(row);
      memory.set(externalId, row);
      continue;
    }

    if (sameRow(last, row)) continue;
    if (isTerminal(last.state) && isTerminal(row.state)) continue;

    changes.push(row);
    memory.set(externalId, row);
  }

  for (const [externalId, last] of memory) {
    if (present.has(externalId)) continue;
    memory.delete(externalId);
    if (isTerminal(last.state)) continue;
    changes.push({ externalId, state: "cancelled", doneBytes: last.doneBytes });
  }

  return changes;
}

export type { DownloadId, DownloadMemory, DownloadSnapshot };
