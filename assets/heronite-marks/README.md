# Heronite's marks

The two application icons the launcher tiles name, kept here as the masters punktfunk's client art
needs. `graphite.svg` is Heronite's full icon and `graphite-small.svg` its small one, both verbatim
from the Heronite project.

The plugin names them as brand-mark tokens — `heronite` on the desktop tile, `heronite-console` on
console mode — because `icon` takes a token matching `[a-z][a-z0-9-]{0,31}` that each client
resolves against the marks it bundles. A tile therefore stays a name on an accent face until the art
ships in punktfunk's `assets/launcher-icons`, where these files belong; this plugin needs no change
when it does.

They are not in the published package: `files` in `package.json` lists only `dist` and the two code
licences.

## Licence

The Heronite marks are licensed **CC BY-SA 4.0** by the Heronite project, and are kept separate from
this package's MIT OR Apache-2.0 code.

- Title: Heronite icons
- Author: Rafael Goulart B — <https://github.com/RafaelGoulartB/Heronite>
- Source: <https://github.com/RafaelGoulartB/Heronite/tree/main/packaging/icons>
- Licence: Creative Commons Attribution-ShareAlike 4.0 International —
  <https://creativecommons.org/licenses/by-sa/4.0/>

They are the Heronite project's trademarks, used here to identify the application a tile opens, and
imply no affiliation or endorsement.
