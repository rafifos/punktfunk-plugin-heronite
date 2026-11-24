# Reimplement Heronite's on-disk formats independently

Heronite is GPL-3.0 and this plugin is MIT OR Apache-2.0. The plugin treats Heronite's JSON files and protocol URL as a data interface: its TypeScript types, parser, and tests are written from observed file shapes and documented behaviour, not copied or translated from Heronite's Rust sources. The Heronite checkout under `__references/` stays out of version control and is used only to answer questions about the interface. A schema change in Heronite is handled by updating our parser and fixtures, not by importing Heronite code.
