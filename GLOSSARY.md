# Punktfunk and Heronite plugin

The vocabulary this repository uses to describe how a Punktfunk host learns about, launches, and reports on games managed by Heronite.

## Language

### Punktfunk

**Host**:
The PC being streamed from, which runs the plugin runner and the management API.
_Avoid_: Server, machine

**Library source**:
A plugin that publishes game entries to the host's library.
_Avoid_: Provider, scanner, importer

**Provider entry**:
One game row a library source publishes, identified on the host as `<plugin>:<external_id>`.
_Avoid_: Item, record

**External id**:
The stable, plugin-scoped identifier a library source gives one provider entry.
_Avoid_: GUID, slug

**Launch spec**:
The host-owned description of how to start one title. A plugin supplies a validated kind and values; it never supplies a command.
_Avoid_: Launch command, argv

**Exec template**:
A named program-and-argument template declared in the plugin manifest, whose `{param}` placeholders are filled from a provider entry.
_Avoid_: Launcher, wrapper

**Install state**:
Whether a title's files are on the host: `installed` or `missing`, optionally with a size.
_Avoid_: Download state, presence

**Download row**:
One progress report a library source sends for a title it lists as missing.
_Avoid_: Progress event, transfer

**Per-game tab**:
A plugin-owned section on one game's page in the host console.
_Avoid_: Details page, panel

**Launcher tile**:
A provider entry whose role is `launcher`: it opens a launcher's own interface rather than a game.
_Avoid_: App tile, shortcut

### Heronite

**Data root**:
The folder Heronite keeps its library, settings, sessions, and caches in.
_Avoid_: Config folder, database

**Runner**:
Heronite's provenance dimension for a game: the store, launcher, or emulation path it came from.
_Avoid_: Shop, source, store

**App name**:
Heronite's identifier for a game within one runner. Steam entries use `steam_<appid>` as their app name.
_Avoid_: Game id, object id

**Library key**:
Heronite's in-memory identity for a game: `<runner>_<appName>`.
_Avoid_: Collection id

**Metadata key**:
The key Heronite's overlay data uses for a game: `<runner>:<appName>`.
_Avoid_: Art key, overlay key

**Launch kind**:
How Heronite starts a game: a Steam URI, a local executable, an emulator, another launcher, a store client, an Xbox package, or no method at all.
_Avoid_: Launch type, method

**Local metadata**:
Heronite's per-game overlay recording how the game starts and which emulator, ROM, or executable it uses.
_Avoid_: Sideload entry

**Collection metadata**:
Title, description, and catalog details Heronite fetched for a game.
_Avoid_: Metadata cache

**Copy**:
The same game owned in more than one store, which Heronite can group as one card.
_Avoid_: Duplicate, variant

**Hidden game**:
A game the user removed from Heronite's Collection while keeping it in its store.
_Avoid_: Ignored game

**Console mode**:
Heronite's controller-first, full-screen interface.
_Avoid_: Big Picture

**Protocol URL**:
A `heronite://` address that asks Heronite to launch a game, stop one, or open an interface.
_Avoid_: Deep link, URI

**Download queue**:
The ordered list of store downloads Heronite runs itself.
_Avoid_: Download manager, transfers

**Playtime**:
The minutes Heronite has recorded for a game across its sessions.
_Avoid_: Game time

**Status**:
Heronite's completion label for a game, such as Playing, Beaten, or Completed.
_Avoid_: State

### Retired language

**Hydra**:
The launcher this repository's plugin targeted before the retarget. Hydra support has been removed; the upstream Hydra plugin remains its own project.
_Avoid_: Using "Hydra" for anything in the new design.
