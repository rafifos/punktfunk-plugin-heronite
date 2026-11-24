#!/usr/bin/env bun
// `punktfunk-plugin-heronite <command>`: `detect`, `scan [--preview]`, `parity` and `uninstall`,
// all from the kit.
import { plugin } from "./plugin.js";

await plugin.cli();
