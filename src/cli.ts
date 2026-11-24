#!/usr/bin/env bun
// `punktfunk-plugin-heronite <command>`: `detect`, `scan [--preview]`, `paths`, `parity` and
// `uninstall`.
import { plugin } from "./plugin.js";

await plugin.cli();
