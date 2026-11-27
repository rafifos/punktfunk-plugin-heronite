/**
 * npm collapses every failed trusted-publishing exchange into a bare `ENEEDAUTH` and only reports
 * the registry's reason at `--loglevel verbose`. This performs the same exchange before the build
 * and prints what the registry actually said, so a refused release names its own fix instead of
 * sending the reader to npm's debug log.
 *
 * Exit 0: the registry accepts this run's OIDC identity, or a repository token supplies the
 * credential and there is nothing to exchange. Exit 1: it refused, and the reason is on stderr.
 *
 * GitHub Actions supplies `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` when
 * the job has `id-token: write`. `PREFLIGHT_OIDC_URL` and `PREFLIGHT_REGISTRY` exist for the test.
 */

import { readFileSync } from "node:fs";

interface PackageJson {
  name: string;
  publishConfig?: { registry?: string };
}

type Verdict = { ok: true } | { ok: false; reason: string };

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageJson;

const notice = (line: string) => console.log(`::notice::${line}`);
const fail = (line: string) => console.error(`::error::${line}`);

/** npm's `npa().escapedName`: the scope separator becomes `%2f`, which is what the endpoint takes. */
function escapedName(name: string): string {
  return name.replace("/", "%2f");
}

/**
 * The exchange npm performs, kept separate so the decision is readable and testable: a 200 with a
 * token is the only success, and anything else carries the registry's own explanation.
 */
function verdict(status: number, body: string): Verdict {
  let parsed: { token?: unknown; message?: unknown; error?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: `HTTP ${status}, unparseable response` };
  }
  if (status === 200 && typeof parsed?.token === "string" && parsed.token.length > 0) {
    return { ok: true };
  }
  const reason = parsed?.message ?? parsed?.error ?? JSON.stringify(parsed);
  return { ok: false, reason: `HTTP ${status}: ${String(reason)}` };
}

/**
 * What a refusal usually means, in the words of the person who has to repair it. npm's own message
 * is kept above this; the mapping only saves a round of guessing.
 */
function hint(status: number): string | undefined {
  switch (status) {
    case 401:
      // GitHub mints the token in a real run, so a missing binding is the usual cause, but the
      // registry answers the same way to a token it cannot verify, and naming one cause when there
      // are two is how a repair gets made against the wrong file.
      return "the registry did not accept this run's identity: usually no trusted publisher matches this repository, workflow file and package";
    case 403:
      return "a binding exists but does not allow publishing: re-bind it with --allow-publish";
    case 404:
      return "the package or its trusted publisher was not found: check the package exists and is yours";
    default:
      return undefined;
  }
}

async function main(): Promise<number> {
  // A repository secret wins in publish.yml, so there is no exchange to preflight.
  if (process.env.NODE_AUTH_TOKEN) {
    notice("a repository secret publishes this run; nothing to preflight");
    return 0;
  }

  const tokenUrl = process.env.PREFLIGHT_OIDC_URL ?? process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!tokenUrl || !requestToken) {
    fail("this job has no id-token endpoint; it needs `permissions: id-token: write`");
    return 1;
  }

  const registry = new URL(
    process.env.PREFLIGHT_REGISTRY ?? pkg.publishConfig?.registry ?? "https://registry.npmjs.org/",
  );

  // The endpoint GitHub hands over already carries its own query, so the audience is appended.
  const url = new URL(tokenUrl);
  url.searchParams.set("audience", `npm:${registry.hostname}`);
  const identity = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${requestToken}` },
  });
  let idToken: string | undefined;
  try {
    idToken = (JSON.parse(await identity.text()) as { value?: string }).value;
  } catch {
    idToken = undefined;
  }
  if (!identity.ok || typeof idToken !== "string" || !idToken) {
    fail(`GitHub refused to mint an id_token (HTTP ${identity.status})`);
    return 1;
  }

  const response = await fetch(
    new URL(`/-/npm/v1/oidc/token/exchange/package/${escapedName(pkg.name)}`, registry),
    {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${idToken}` },
    },
  );
  // Read before deciding: a refusal's body is the whole diagnosis, and a success's holds a token
  // that must never reach the log.
  const outcome = verdict(response.status, await response.text());
  if (outcome.ok) {
    notice(`the registry accepts this run's OIDC identity for ${pkg.name}`);
    return 0;
  }

  fail(`the registry refused the OIDC exchange for ${pkg.name} (${outcome.reason})`);
  const why = hint(response.status);
  if (why) fail(why);
  fail(
    `bind or re-bind the workflow, then re-run: npm trust github ${pkg.name} ` +
      `--repo ${process.env.GITHUB_REPOSITORY ?? "<owner>/<repo>"} --file publish.yml --allow-publish`,
  );
  return 1;
}

// Run only as a program: the test imports `verdict` and `escapedName` without minting a token.
if (import.meta.main) {
  process.exit(await main());
}

export { escapedName, hint, verdict };
