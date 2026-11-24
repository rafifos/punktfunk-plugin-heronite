# Launch every title through Heronite

Heronite owns each game's Wine or Proton prefix, umu identifier, emulator profile, Steam URI, mods, playtime, and session records. Its `heronite://launch` protocol URL reaches the same launch path as the Play button. Starting a game's executable directly from the plugin would duplicate that logic and produce a different game than Heronite's own interface, so every provider entry launches by asking Heronite to start the game and the plugin never targets a game executable itself.
