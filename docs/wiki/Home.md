# Heronite plugin

The plugin publishes a [Heronite](https://heronite.app) library to a
[Punktfunk](https://git.unom.io/unom/punktfunk) host and starts the games through Heronite.

The README in the repository covers what gets listed, the settings and how to install it. These
pages cover the parts that need more than a paragraph.

## Pages

- [Streaming a Heronite game](Streaming-a-Heronite-game): the launch path, the hooks that make a
  streamed launch reliable, the diagnostics log, HDR and 5.1 audio.
- [What sets WAYLAND_DISPLAY](What-sets-WAYLAND_DISPLAY): the black-screen failure, and the two
  settings in a launcher that cause it.

## When a stream shows a black screen

Read the diagnostics log first. It records the display and audio path of each launched game, so the
answer is usually already on disk:

```sh
tail -40 ~/.local/state/punktfunk/stream-diagnostics.log
```

Then read [What sets WAYLAND_DISPLAY](What-sets-WAYLAND-DISPLAY) for the common cause.
