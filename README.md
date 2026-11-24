# punktfunk-plugin-heronite

A [Punktfunk](https://git.unom.io/unom/punktfunk) host plugin that will publish your
[Heronite](https://heronite.app) games to the host's library and start them through Heronite, so
Heronite's Wine/Proton setup, playtime and console mode apply.

**Pre-release.** This is a scaffold: the package builds and loads, but it detects and scans nothing
yet. Games, downloads and the per-game tab arrive in the coming milestones; see the
[port plan](docs/port-plan.md) and the [ADRs](docs/adr/).

New to Punktfunk? [What is Punktfunk?](docs/punktfunk.md) covers the host/client model, how a
stream flows, and where plugins fit.

## Develop

```sh
bun install
bun test
bunx tsc --noEmit
bunx biome check
```

## History

This repository began as the upstream Hydra plugin and was retargeted in place; Hydra support has
been removed. See [ADR-0002](docs/adr/0002-retarget-in-place-drop-hydra.md).

Licensed MIT OR Apache-2.0.

## Use of AI

This project uses AI for writing code.
