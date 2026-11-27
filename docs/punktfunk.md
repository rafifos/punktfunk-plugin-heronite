# What is Punktfunk?

Punktfunk is an open-source, self-hosted system for streaming a PC's desktop and games to other
devices at low latency. It is made by unom and documented at
[punktfunk.unom.io](https://punktfunk.unom.io). There is no cloud service, no account and no
tracking: the two ends meet on your own network, or through a VPN you control.

## The model

Two roles:

- **Host:** the PC you stream _from_. It captures the screen, encodes it on the GPU, sends it, and
  receives input back.
- **Client:** the device you stream _to_, which can be a phone, tablet, Steam Deck, TV or another
  PC.

A client pairs with a host once and reconnects on its own afterwards. Each connected device gets its
own **virtual display** at that device's exact resolution and refresh rate, so several people can
stream from one host without fighting over the physical screen.

The stream is encrypted, with a post-quantum key exchange. The host serves its web console over
HTTPS on port 47992 with its own certificate, so a browser warns once on first use.

## What it runs on

| End       | Support                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host      | Linux on Wayland (KDE Plasma, GNOME, gamescope, Sway, Hyprland, niri through the `biri` fork), or Windows 11 22H2 or later                                              |
| Clients   | Native apps for macOS, iPhone, iPad, Apple TV, Apple Vision Pro, Android phone and TV, Windows, Linux, Steam Deck and LG webOS TVs; Samsung TVs and browsers in preview |
| Moonlight | Connects once GameStream compatibility is switched on in the console                                                                                                    |

X11 desktops and older Windows are not supported, and macOS is a client only by design. Without a
working GPU encoder a Linux host falls back to software H.264, and a Windows host cannot stream at
all.

## How a stream flows

1. The client announces its mode, `WxH@Hz`. The host creates a virtual output at exactly that size
   and refresh rate.
2. The host captures frames from the compositor, or from its own virtual-display driver on Windows,
   and encodes them on the GPU: NVENC, Vulkan Video, VAAPI, Media Foundation, or software.
3. The protocol core splits each encoded frame into packets, adds forward error correction, seals
   them with AES-GCM, and paces them over UDP.
4. The client reassembles, decrypts, decodes on its own GPU and presents.
5. Input travels the other way as QUIC datagrams and arrives on the host as a virtual keyboard,
   mouse, touchpad or gamepad.

Desktop audio goes to the client as Opus; the client's microphone comes back the same way.

## Two protocols

- **`punktfunk/2`** (ALPN `pkf2`) is the native protocol: pairing, mode changes, clock sync,
  adaptive bitrate, clipboard. A browser plane over WebTransport exists but is off unless the host
  runs with `--webtransport`.
- **GameStream** is the compatibility protocol that lets existing Moonlight clients connect. It is
  off by default and meant for a trusted LAN.

## Plugins

A **plugin** is an npm package that the host's plugin runner, a Bun process called
`punktfunk-scripting`, loads and supervises.

- **Discovery.** The runner starts every package listed in `<config>/plugins/package.json` whose name
  is `punktfunk-plugin-*` or `@<scope>/plugin-*`. `<config>` is `~/.config/punktfunk` on Linux and
  `%ProgramData%\punktfunk` on Windows.
- **Shape.** The package's module entry default-exports a plugin definition. A crash restarts the
  plugin with backoff from 1 s to 60 s; a clean return ends it.
- **Manifest.** A `punktfunk` block in `package.json` declares `schema` (`1`), the plugin `id`, the
  paths it `reads`, the folders it reads `files` from, any `writes`, whether it needs `network`,
  `registry` keys, and `exec` argv templates. The host refuses a plugin without it, and nothing the
  plugin does at runtime widens it.
- **Sandbox.** On Linux each plugin runs in its own bubblewrap sandbox with its own PID namespace;
  on Windows in its own AppContainer. Network is off unless the manifest asks for it. On Linux a
  `writes` path outside `/tmp` stays unbound until the operator approves the folder request.
- **API access.** The plugin calls the host's management API with a credential of its own (a scoped
  token, or a named pipe under AppContainer) and reaches only an allowlist: it can publish its own
  library titles, not hooks, pairing, the plugin store or command launches.

Most plugins are **library sources**: they add rows to the host's game library. Others add console
pages or automation. The authoring kit is `@punktfunk/plugin-kit`.

## Where this repo fits

`punktfunk-plugin-heronite` is the library-source plugin for
[Heronite](./heronite.md). It reads Heronite's data folder, publishes the games Heronite can start
to the host's library with Heronite's art and metadata, starts every title through Heronite itself,
mirrors Heronite's store download queue in the host's Downloads list, and adds a read-only per-game
tab with playtime and completion status. See the [README](../README.md) for what gets listed,
setup and development.

The name is historical: the repo began as a fork of the upstream Hydra plugin and was retargeted to
Heronite in place, so the git history still speaks Hydra while the code does not.

## Licence and funding

Punktfunk is MIT OR Apache-2.0, and the source is public. Every download from the website is free.
The App Store and Google Play copies are the same app and cost a few euros; that is how the work is
funded, and nothing is locked behind the price.

## Vocabulary

| Term           | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| Host           | The PC being streamed from.                                                     |
| Client         | The device being streamed to.                                                   |
| Console        | The host's web UI, at `https://<host-ip>:47992`.                                |
| Pairing        | One-time trust between a host and a client, by approval or PIN.                 |
| Mode           | The resolution and refresh rate a client asks for, `WxH@Hz`.                    |
| Plugin runner  | `punktfunk-scripting`, the Bun process that loads and supervises plugins.       |
| Library source | A plugin that publishes game rows to the host's library.                        |
| Management API | The host's HTTPS API under `/api/v1`, used by the console, the SDK and plugins. |

## Further reading

- [Website](https://punktfunk.unom.io)
- [Documentation](https://docs.punktfunk.unom.io)
- [Quick start](https://docs.punktfunk.unom.io/docs/quickstart)
- [Writing plugins](https://docs.punktfunk.unom.io/docs/developers/writing-plugins)
- [Architecture](https://docs.punktfunk.unom.io/docs/developers/architecture)
- [API reference](https://docs.punktfunk.unom.io/api)
- [Source code](https://git.unom.io/unom/punktfunk)
- [GitHub organisation](https://github.com/punktfunk): the host source, plus the PS5, Switch, Tizen,
  web and webOS client apps
- [Bugs, ideas and roadmap](https://improve.unom.io/p/punktfunk)
- [Comparison with Sunshine, Steam Remote Play and Parsec](https://punktfunk.unom.io/en/compare)

---

Written from [punktfunk.unom.io](https://punktfunk.unom.io) and
[docs.punktfunk.unom.io](https://docs.punktfunk.unom.io), read 2026-11-24.
