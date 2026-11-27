# Changelog

## [0.4.0](https://github.com/rafifos/punktfunk-plugin-heronite/compare/v0.3.0...v0.4.0) (2026-11-27)


### Features

* **launcher:** art, metadata and provenance for the two tiles ([7ea2af1](https://github.com/rafifos/punktfunk-plugin-heronite/commit/7ea2af18553c65cd972d803ba5773ad5c735f75f))
* **stream-prep:** let the plugin's streaming settings skip the prep and restore hooks ([09f514d](https://github.com/rafifos/punktfunk-plugin-heronite/commit/09f514d36235aabdd2c3780f9adca30d1f081f8d))

## [0.3.0](https://github.com/rafifos/punktfunk-plugin-heronite/compare/v0.2.0...v0.3.0) (2026-11-27)


### Features

* **launcher:** name a distinct brand mark for each tile ([8534eef](https://github.com/rafifos/punktfunk-plugin-heronite/commit/8534eef456c59f22a837b75a92b67ebb7c876245))
* **launcher:** one mark for both tiles, licensed GPL-3.0 ([1ad955a](https://github.com/rafifos/punktfunk-plugin-heronite/commit/1ad955aab04a8e9b9ef767f1c8b9e46a173ef6c7))


### Bug Fixes

* **art:** serve the art Heronite already holds instead of guessing the CDN ([043494b](https://github.com/rafifos/punktfunk-plugin-heronite/commit/043494bcda2b2e72ee6eeb8e26ecfdf17a8cc426))
* **contrib:** drop the guard that re-broke the desk-game decision ([03794ca](https://github.com/rafifos/punktfunk-plugin-heronite/commit/03794ca6836534093c7c69022489ee58fd4cd824))


### Reverts

* **assets:** stop asserting a licence these files do not hold ([644aceb](https://github.com/rafifos/punktfunk-plugin-heronite/commit/644aceb2f07b1af4a71d0553d407e062b0c138fd))

## [0.2.0](https://github.com/rafifos/punktfunk-plugin-heronite/compare/v0.1.1...v0.2.0) (2026-11-25)


### Features

* **stream-prep:** log the audio plumbing with the display evidence ([a49fc14](https://github.com/rafifos/punktfunk-plugin-heronite/commit/a49fc14757a5009214f502ed2e59b541a7020b94))


### Bug Fixes

* **contrib:** stop the desk game when it is the title being streamed ([9be33f9](https://github.com/rafifos/punktfunk-plugin-heronite/commit/9be33f980840ebe37f0a17b816fce6278f3f9b3d))
* report a failed parity snapshot write instead of dying ([b129e11](https://github.com/rafifos/punktfunk-plugin-heronite/commit/b129e11f2e5ff853bfc9ab817240144f35537566))
* turn Wine's Wayland driver off for every game this plugin launches ([7ab826e](https://github.com/rafifos/punktfunk-plugin-heronite/commit/7ab826ecabb631d28064b1d0efa7ceabc5d5f43b))


### Reverts

* the manifest cannot turn Proton's Wayland driver off ([1dd639d](https://github.com/rafifos/punktfunk-plugin-heronite/commit/1dd639d6a2b7d152168f9972d2657c62dd7e0ef0))

## [0.1.1](https://github.com/rafifos/punktfunk-plugin-heronite/compare/v0.1.0...v0.1.1) (2026-11-25)


### Bug Fixes

* **ci:** read the version out of a component-prefixed release tag ([92aca25](https://github.com/rafifos/punktfunk-plugin-heronite/commit/92aca255f535bc19bc8f6cb8e1059b8d28a70a19))

## 0.1.0 (2026-11-25)


### Features

* add Matt Pocock's skills ([5c20cd7](https://github.com/rafifos/punktfunk-plugin-heronite/commit/5c20cd7bebe8745c80f9ea726cbec49d27be5e1d))
* **contrib:** ship the streaming hooks with a one-command installer ([21b3ad2](https://github.com/rafifos/punktfunk-plugin-heronite/commit/21b3ad22aaccdaef1bb51f01b89ff5d7270ee754))
* **downloads:** mirror Heronite's queue and refuse its install asks ([3af5190](https://github.com/rafifos/punktfunk-plugin-heronite/commit/3af519061edf1632b51d33eac7c3f83facf7c5fe))
* **heronite:** read the data root, JSON files and game model ([8c57352](https://github.com/rafifos/punktfunk-plugin-heronite/commit/8c57352f5581fe22d4b8f40cd00ff5b7b959a791))
* **heronite:** scan the collection into entries and launcher tiles ([6f6deaf](https://github.com/rafifos/punktfunk-plugin-heronite/commit/6f6deaf7de0a40468112d1c96b49b704badd3b69))
* **plugin:** serve the read-only per-game tab ([ed1985d](https://github.com/rafifos/punktfunk-plugin-heronite/commit/ed1985d6b019cea40aa59500275d1c2885aa0d39))
* **plugin:** wire settings, sync loop and the CLI ([3888773](https://github.com/rafifos/punktfunk-plugin-heronite/commit/3888773ef1cb4368625b95ca26841e5cb9b72341))
* **scaffold:** retarget the package to Heronite ([c216784](https://github.com/rafifos/punktfunk-plugin-heronite/commit/c2167849f74cfbcf606b44f64aa1d6602bb80549))


### Bug Fixes

* apply the code-review findings to the Heronite port ([2969c97](https://github.com/rafifos/punktfunk-plugin-heronite/commit/2969c97645daa4eda31d8673b29dff9437d58da2))
* **contrib:** never stop a Steam game running at the desk ([1063604](https://github.com/rafifos/punktfunk-plugin-heronite/commit/10636044589b23d7edd85d0f3de7676688d22e63))
* **heronite:** honour XDG_DATA_HOME for the manifest roots ([b2c32c1](https://github.com/rafifos/punktfunk-plugin-heronite/commit/b2c32c19fa53877e377fb1a1315da86d59302b3f))
* **launch:** run Heronite's AppImage, and never hand the host a dead path ([adb13ae](https://github.com/rafifos/punktfunk-plugin-heronite/commit/adb13ae91d742cc830fa37057b690dd37017af09))
* read the plugin def's version from package.json ([2e755d7](https://github.com/rafifos/punktfunk-plugin-heronite/commit/2e755d767cb2023a25a1a7beb75cc65be9860da4))
* ship the license texts in the tarball ([ca9b3f4](https://github.com/rafifos/punktfunk-plugin-heronite/commit/ca9b3f42795fa358c2eda457020687a51ef8245e))
