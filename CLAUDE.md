# Lichtblick (Peppermint fork)

Peppermint's fork of Lichtblick (Foxglove Studio). Shipped two ways from the **same** source:

- **Desktop** (`packages/suite-desktop`, entry `packages/suite-desktop/src/renderer/Root.tsx` →
  `App` → `Workspace`) — used for internal development.
- **Web** (`packages/suite-web`, entry `packages/suite-web/src/WebRoot.tsx` → `SharedRoot` →
  `StudioApp` → `Workspace`) — packaged and shipped inside another Peppermint app used by field
  engineers.

Shared UI/logic lives in `packages/suite-base`. Anything that must work on both builds belongs
there — both entry points render the same `Workspace`.

Build with the `justfile` (`just --list`). Outputs: web → `web/.webpack`, desktop →
`desktop/.webpack`, packaged installers → `dist/`. See `README.md`.

## Default layouts (bundled into both builds)

Peppermint ships ready-made debugging layouts so anyone can open a bag and get a useful view.

- **Registry:** `packages/suite-base/src/layouts/index.ts` exports `bundledLayouts`
  (open-source `robotDiagnostics.json` + `...privateLayouts`). Re-exported from the
  `@lichtblick/suite-base` barrel.
- **Loader:** `packages/suite-base/src/services/BundledLayoutLoader.ts` implements `LayoutLoader`.
  It serves the bundled layouts **and** merges a remote manifest (`layouts/index.json` next to the
  bundle, or `?layoutsUrl=`), so the host app can override/extend layouts without a rebuild.
- **Wiring:** both entry points build a `layoutLoaders` array and pass it down to
  `CurrentLayoutProvider`. Desktop = `[new BundledLayoutLoader(bundledLayouts), new
  DesktopLayoutLoader(...)]`; web = `BundledLayoutLoader` only. `loadDefaultLayouts.ts` dedupes by
  `from` and does versioned replacement (`web:<name>@<version>` — bump `version` to push updated
  content to existing installs).

**Desktop import gotcha (do not regress):** `renderer/Root.tsx` imports `bundledLayouts` /
`BundledLayoutLoader` from the `@lichtblick/suite-base` **barrel**, never the
`@lichtblick/suite-base/layouts` subpath. The subpath matches the `@lichtblick/suite-base/*`
tsconfig `paths` mapping and pulls suite-base **source** into the desktop renderer's compilation,
which violates its `rootDir` (`TS6059`). The bare barrel resolves through `node_modules` and is
rootDir-exempt. Keep new desktop-side suite-base imports on the barrel.

## Proprietary layouts (git submodule)

`packages/suite-base/src/layouts/private/` is a **git submodule**
(`github.com/Peppermint-Robots/litchtblick_private`) kept out of this MPL-2.0 repo. Consumed via
the `@lichtblick/private-layouts` alias, resolved in `packages/suite-base/webpack.ts` (`makeConfig`,
used by both web and desktop webpack) with a `noPrivateLayouts.ts` empty-list fallback when the
submodule is absent. The alias is mirrored across several tsconfigs + jest configs — see the
submodule's own `CLAUDE.md` for the full mirror list and layout-authoring workflow. Never move a
layout JSON into this repo.

## Automatic robot-namespace handling — works on BOTH builds

Peppermint topics are namespaced `/<robot_id>/<topic>`. Layouts are authored against whatever robot
was on hand, then adapted to the connected robot at runtime — **no `$variable` topics** (Lichtblick's
message-path grammar forbids variables in the topic-name position).

- `packages/suite-base/src/components/RobotNamespaceLayoutAdapter.tsx` is mounted in
  `Workspace.tsx`, **inside** `PanelStateContextProvider`. Because `Workspace` is shared, this runs
  identically on desktop and web.
- `packages/suite-base/src/util/robotNamespaceLayout.ts`: `detectRobotNamespace` picks the most
  common first path segment (denylist: `diagnostics`, `rosout`, `parameter_events`, `clock`;
  overridable via the `robot_id` global variable), and `rewriteConfigTopics` recursively rewrites
  topic references in every panel config to the connected robot's namespace. A reference whose
  first segment looks like a robot ID (all-uppercase alphanumeric with digits, e.g. `SD0452000`)
  is re-namespaced even when the connected source lacks that topic — the panel then shows the
  current robot's topic name and binds if the topic appears later on a live connection. Generic
  references (`/odom`) and functional first segments (`/safety_region/...`) are only rewritten
  when the target topic actually exists.
- Runs for any data source (MCAP bag or live connection) and any layout, not just Peppermint's own.

## Automatic topic visibility — works on BOTH builds

Per-topic settings (including `visible`) carry across robots, and enabling a topic once keeps it
enabled when you switch robots/bags. Enforced by the same `RobotNamespaceLayoutAdapter`:

- After rewriting a panel's config it calls `savePanelConfigs` **and** `incrementSequenceNumber(id)`.
  The sequence bump is required because `PanelExtensionAdapter` panels (3D, Image, Gauge, Indicator)
  read their config once via `initialState` and only pick up changes on remount.
- On namespace collision (a layout carrying entries for several robots collapses onto one key) the
  **enabled** entry wins.
- A `signature` guard (`layoutId + namespace + topicNames.size`) prevents the effect from re-running
  every player frame — this is what avoids the WebGL context-exhaustion crash (the adapter also calls
  `forceContextLoss()` on 3D renderer dispose).

Since all of this lives in shared `suite-base` and mounts in the shared `Workspace`, **namespace
resolution and visibility auto-enable are active on the desktop build exactly as on web** — no
desktop-specific wiring needed.

## Robot Mode panel (`packages/suite-base/src/panels/RobotMode/`)

Shows the robot's overall operating mode. No single topic carries it, and the stock Indicator panel
cannot express it: Indicator subscribes to exactly one topic and compares the whole value with `===`,
whereas the drive mode is one field inside a **stringified float array**.

Inputs (all subscribed by the panel; topics are stored unnamespaced and rewritten by the
robot-namespace adapter like any other layout topic):

| Topic | Type | Used for |
| --- | --- | --- |
| `op_speed_from_gui` | `std_msgs/String` | `[0]` drive mode, `[3]` auto play/pause |
| `auto_mode_status` | `std_msgs/Float32` | play flag fallback (2 Hz, latched) |
| `modbus_to_gui` | `std_msgs/UInt8MultiArray` | `[6]` e-stop, `[10]` stop-and-hold button |
| `initial_localization_status` | `GenericStatus` | `state == 1` → auto-localization running |
| `current_velocity_source` | `std_msgs/String` | `teleop_cmd_vel` → teleop |

`op_speed_from_gui` is `"[mode, manual_speed, auto_speed, auto_started]"` with **two encodings on the
wire** — the C++ `std::to_string` form from state_manager (`"[1.000000,0.400000,...]"`) and strict
JSON from the mqtt/FMS clients (`"[1.0, 0.4, ...]"`). `parseOpSpeed` accepts both and returns
`undefined` rather than throwing, mirroring `LocalizationManager::parseOpSpeedPayload`. Mode values
mirror `enum class Mode` in `state_machine_context.hpp`: 0 MANUAL, 1 AUTO, 2 TELEOP, 3 AUTO_LOC.

`deriveRobotMode` applies a deliberate **safety-first precedence**: e-stop → pause button →
auto-localization → teleop → auto (play/paused) → manual → unknown. A pressed e-stop is what the
operator most needs to see, so it outranks every software mode. `auto_started` is force-zeroed by
state_manager for non-AUTO modes, so the play/pause split only applies under AUTO; `auto_mode_status`
is the fallback because `op_speed_from_gui` is published **on change only** and a late-joining
subscriber can otherwise sit blank.

All derivation is pure and unit-tested in `deriveRobotMode.test.ts` — extend the tests there rather
than reasoning about the panel through the UI.

## MCAP latched / publish-once retention

Transient-local / published-once topics (notably `/tf_static`) were dropped after seeks. Fixes,
both on the shared player path so they apply to desktop and web:

- Transform **preloading defaults ON** (`ThreeDeeRender` `enablePreloading` unset → true), replaying
  all tf/tf_static across seeks. Explicit `false` in a saved layout is still respected.
- `IterablePlayer` triggers seek-backfill on subscription changes **while playing** too (the
  `!isPlaying` guard was removed), so a panel opened mid-playback on a publish-once topic renders
  without a manual pause/seek.

The high-frequency (>60 Hz) informational alert was removed (`IterablePlayer`,
`FoxgloveWebSocketPlayer`) — Peppermint intentionally views high-rate topics.
