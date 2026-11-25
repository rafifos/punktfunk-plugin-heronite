import { afterEach, describe, expect, it } from "bun:test";

import { escapedName, hint, verdict } from "../scripts/preflight-trusted-publish";

/**
 * The script exists because npm reports a refused trusted-publishing exchange as a bare
 * `ENEEDAUTH`. What it has to get right is therefore the message, so these drive it against a
 * stand-in registry rather than assert on npm's behaviour.
 */

const servers: Array<() => void> = [];

afterEach(() => {
  for (const stop of servers.splice(0)) stop();
});

/** A registry + GitHub identity pair; `exchange` decides what the package endpoint answers. */
interface Identity {
  status: number;
  body: unknown;
}

interface FakeOptions {
  exchange?: (request: Request) => Response | Promise<Response>;
  identity?: Identity;
}

function fake({
  exchange = () => new Response("{}", { status: 500 }),
  identity = { status: 200, body: { value: "oidc-token" } },
}: FakeOptions = {}) {
  const seen: Array<{ authorization: string | null; path: string; audience?: string | null }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname, searchParams } = new URL(request.url);
      if (pathname === "/token") {
        seen.push({
          authorization: request.headers.get("authorization"),
          path: pathname,
          audience: searchParams.get("audience"),
        });
        return new Response(JSON.stringify(identity.body), { status: identity.status });
      }
      seen.push({ authorization: request.headers.get("authorization"), path: pathname });
      return exchange(request);
    },
  });
  servers.push(() => server.stop());
  return { url: `http://localhost:${server.port}`, seen };
}

async function run(base: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "scripts/preflight-trusted-publish.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PREFLIGHT_OIDC_URL: `${base}/token?x=1`,
      PREFLIGHT_REGISTRY: `${base}/`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
      GITHUB_REPOSITORY: "rafifos/punktfunk-plugin-heronite",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("the trusted-publishing preflight", () => {
  it("passes, and asks for the audience the registry is", async () => {
    const registry = fake({
      exchange: () => Response.json({ token: "short-lived" }),
    });
    const { stdout, code } = await run(registry.url);

    expect(code).toBe(0);
    expect(stdout).toContain("the registry accepts this run's OIDC identity");
    // The audience is what npm derives from the registry host; a mismatch is a silent refusal.
    expect(registry.seen[0]?.audience).toBe("npm:localhost");
    expect(registry.seen[0]?.authorization).toBe("Bearer request-token");
    expect(registry.seen[1]?.path).toBe(
      "/-/npm/v1/oidc/token/exchange/package/@rafifos%2fplugin-heronite",
    );
    expect(registry.seen[1]?.authorization).toBe("Bearer oidc-token");
  });

  it("echoes the registry's own reason instead of ENEEDAUTH", async () => {
    const registry = fake({
      exchange: () =>
        Response.json(
          { message: "No trusted publisher is configured for @rafifos/plugin-heronite" },
          { status: 404 },
        ),
    });
    const { stderr, code } = await run(registry.url);

    expect(code).toBe(1);
    expect(stderr).toContain("No trusted publisher is configured");
    expect(stderr).toContain("HTTP 404");
    // The registry's message is the fact; the hint saves a round of guessing what to do with it.
    expect(stderr).toContain("the package or its trusted publisher was not found");
  });

  it("names the re-bind command with the repository the run is in", async () => {
    const registry = fake({ exchange: () => Response.json({ message: "no" }, { status: 403 }) });
    const { stderr } = await run(registry.url, {
      GITHUB_REPOSITORY: "rafifos/punktfunk-plugin-heronite",
    });

    expect(stderr).toContain(
      "npm trust github @rafifos/plugin-heronite --repo rafifos/punktfunk-plugin-heronite --file publish.yml",
    );
  });

  it("never prints the minted token", async () => {
    const registry = fake({ exchange: () => Response.json({ token: "s3cr3t-short-lived" }) });
    const { stdout, stderr } = await run(registry.url);

    expect(stdout).not.toContain("s3cr3t-short-lived");
    expect(stderr).not.toContain("s3cr3t-short-lived");
  });

  it("does nothing when a repository token supplies the credential", async () => {
    const { stdout, code } = await run("http://127.0.0.1:1", { NODE_AUTH_TOKEN: "token" });

    expect(code).toBe(0);
    expect(stdout).toContain("nothing to preflight");
  });

  it("fails when GitHub will not mint an identity token", async () => {
    const registry = fake({ identity: { status: 403, body: { message: "nope" } } });
    const { stderr, code } = await run(registry.url);

    expect(code).toBe(1);
    expect(stderr).toContain("refused to mint an id_token");
  });

  it("reads a token only from a 200 with one in the body", () => {
    expect(verdict(200, '{"token":"t"}')).toEqual({ ok: true });
    expect(verdict(200, "{}").ok).toBe(false);
    expect(verdict(200, '{"token":""}').ok).toBe(false);
    expect(verdict(401, '{"message":"Unauthorized"}')).toEqual({
      ok: false,
      reason: "HTTP 401: Unauthorized",
    });
    expect(verdict(502, "<html>bad gateway</html>").ok).toBe(false);
  });

  it("says what each refusal status usually means", () => {
    expect(hint(401)).toContain("no trusted publisher matches");
    // Not "is": a token the registry cannot verify answers 401 too.
    expect(hint(401)).toContain("did not accept");
    expect(hint(403)).toContain("--allow-publish");
    expect(hint(404)).toContain("was not found");
    expect(hint(500)).toBeUndefined();
  });

  it("escapes a scope the way npm's endpoint expects", () => {
    expect(escapedName("@rafifos/plugin-heronite")).toBe("@rafifos%2fplugin-heronite");
    expect(escapedName("unscoped")).toBe("unscoped");
  });
});
