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

**Switching layouts in the app:** the picker is the **Layouts** tab in the **left sidebar**
(Panel / Topics / Alerts / Layouts) — that is where all bundled layouts appear ("Robot Diagnostics",
"Robot Debug", plus anything saved locally). There is deliberately no layout control in the app bar:
`AppBar` renders `appBarLayoutButton` from `useAppContext`, and neither the desktop nor the web
entry point supplies one, so that slot is empty. The `Workspace.tsx` sidebar entry guarded by
`if (!enableNewTopNav)` is the *old* nav's duplicate of the same browser, not a second feature —
desktop runs with the new top nav, so the left-sidebar tab is the only route. If someone reports
that layout switching "disappeared", check that tab before suspecting a regression.

## Proprietary layouts (git submodule)

`packages/suite-base/src/layouts/private/` is a **git submodule**
(`github.com/Peppermint-Robots/litchtblick_private`) kept out of this MPL-2.0 repo. Consumed via
the `@lichtblick/private-layouts` alias, resolved in `packages/suite-base/webpack.ts` (`makeConfig`,
used by both web and desktop webpack) with a `noPrivateLayouts.ts` empty-list fallback when the
submodule is absent. The alias is mirrored across several tsconfigs + jest configs — see the
submodule's own `CLAUDE.md` for the full mirror list and layout-authoring workflow. Never move a
layout JSON into this repo.

**Squash-merge caveat.** `main` on the private repo is protected, so layout changes go through a PR
on a branch — and the team squash-merges, which lands the change on `main` under a **new SHA**. The
pointer committed here still names the pre-merge commit, which vanishes when GitHub deletes the
merged branch; a fresh `clone --recurse-submodules` then fails with "reference is not a tree".
After the PR merges, run `scripts/repoint-private-layouts.sh` and push the fork. It checks that the
merged `main` has the identical tree before re-pointing (a squash changes the SHA, never the tree)
and refuses if `main` has moved on beyond your PR, so it cannot silently absorb someone else's
layout change.

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
than reasoning about the panel through the UI. `bagReplay.test.ts` additionally replays a real
recording (`fixtures/bagTransitions.json`, condensed from a snapshot covering auto-localization →
manual → auto cleaning → GUI pause → e-stop → physical pause button) and asserts the resulting mode
sequence; regenerate the fixture with `scripts/extractRobotModeFixture.py <bag.mcap>` if a new
recording is captured. That recording is also what confirmed both `op_speed_from_gui` encodings
occur on the *same* robot within one session.

**Detail-line color:** the line under the mode label derives its color from the mode color via
`palette.augmentColor(...).contrastText`, not from `palette.text.secondary`. The theme's fixed grey
scored 1.02:1 against the pause-button orange — invisible. `contrast.test.ts` locks this in; keep
the detail line subordinate by weight/size rather than by fading it, which is what broke contrast.

## Robot Errors panel (`packages/suite-base/src/panels/RobotErrors/`)

Lists the robot's currently active error or warning codes, the way the robot's own GUI does. One
panel type serves both lists — the `severity` config selects which — so a layout can show Errors and
Warnings side by side (Robot Debug does).

`error_codes_list` is a `std_msgs/String` whose `data` is JSON:
`{"error": ["E001"], "warnings": ["W002"]}` (note: `error` singular, `warnings` plural). Properties
that drive the implementation, all verified against a recording:

- **Full snapshot, ~10 Hz, not latched.** Both lists are rebuilt from scratch every 100 ms, so an
  empty array genuinely means "nothing active" and a vanished code has cleared. Panel state is
  replaced wholesale, never accumulated. Identical payloads are skipped so React does not re-render
  10×/s.
- **A malformed payload must not clear the list.** Only payloads that parse are adopted; otherwise a
  single bad publish would blank the panel and, at 10 Hz, visibly flicker. (`parseErrorCodes`
  returns `undefined` rather than throwing.)
- **"No message yet" ≠ "no errors".** The panel says `Waiting for <topic>` until the first payload,
  so a silent robot never reads as healthy.
- **Duplicates happen** — the publisher pushes without a uniqueness check and some conditions push
  the same code from two branches, so codes are deduped while preserving array order, which encodes
  the publisher's intended priority.
- **No timestamps on the wire.** Age is synthesised, and a code that clears and returns is timed
  from its reappearance. It must be measured against `renderState.currentTime` (the playhead),
  **never `Date.now()`** — a wall-clock age keeps counting while playback is paused, ignores playback
  speed, and renders a negative value when the user scrubs backwards. Measuring in bag time makes
  the age a property of the recording: identical on every replay. `updateFirstSeen` also re-stamps a
  code whose stored time is in the future, which is what a backwards scrub produces. Because the
  player emits a render state whenever time advances, `currentTime` doubles as the re-render trigger
  — the panel needs no wall-clock ticker.

**Entry backgrounds must stay opaque.** Each entry sits on a wash of its severity color, produced by
mixing the accent *into* `background.paper` with the local `mix()` helper — deliberately **not**
`alpha(accent, …)`. A translucent fill composites over whatever happens to sit behind the panel, so
the real rendered backdrop is unknown and `getContrastText` cannot decide black-vs-white against it.
That mistake shipped once: the light theme drew near-white text on a near-white wash. With an opaque
wash the text color follows the theme correctly — black on light, white on dark.
`renderedColors.test.tsx` reads the computed styles off the rendered DOM (rather than re-deriving the
formula, which would repeat the same wrong assumption) and asserts the fill is opaque and the text
sits on the opposite side of mid-grey from it.

**Unknown codes are always displayed.** The robot injects "external errors" straight onto the list
without going through its own code catalog, and `errorCatalog.ts` is a generated snapshot that drifts
as robot software changes. An unrecognised code renders as itself, flagged, rather than being
dropped — a field engineer on a newer robot must never see an error silently disappear. Severity
always comes from the array the code arrived in, never from the catalog, since classification is a
policy choice on the robot.

**The catalog text is proprietary and lives in the submodule, not here.** `errorCatalog.ts` in this
package declares only the *types* and re-exports `privateErrorCatalog` from
`@lichtblick/private-layouts`; the actual operator-facing strings are Peppermint's, lifted verbatim
from the robot GUI's assets, and ship in `src/layouts/private/errors/` (with the generator script and
the recorded fixture). An open-source checkout resolves the alias to `noPrivateLayouts.ts`, gets an
empty catalog, and the panel still works — every code renders as "unrecognised", the same path a
code newer than the build takes. Regenerate the data with
`src/layouts/private/errors/scripts/generateErrorCatalog.py <peppermint_os root>`.

Field engineers have no repo checkout, so the catalog ships bundled in the deb; when it goes stale,
the panel's **Code catalog → Override** setting accepts a newer `robot_errors.json` pasted in,
merged over the bundled one.

**Tests must not depend on the catalog.** Jest's `moduleNameMapper` always points the alias at the
empty stub, so any test needing display text supplies its own via `catalogOverride`, and the
recording-replay block skips itself when `privateErrorCodeFixture` is empty. To run those against
the real data, point the mapper at `src/layouts/private/index.ts` (see the submodule's CLAUDE.md).

## 3D panel: reset view

Upstream ships a "Reset view" button in `RendererOverlay`, but it was wired only to image mode —
`canResetView()` returned `imageModeExtension?.hasModifiedView() ?? false`, which is always `false`
in 3D, so the button never appeared. Peppermint layouts use `followMode: "follow-none"` with
`followTf: "map"`, so panning away leaves no way back other than hunting for the map by hand; the
button now works in 3D too.

- `Renderer.resetView()` in 3D restores `DEFAULT_CAMERA_STATE` — the same thing the existing
  **Reset camera** settings action does, so the two routes cannot drift apart. It writes the config
  (persisting into the layout) *and* applies the state to the camera handler, so the view moves now
  instead of waiting for the config to round-trip through React.
- `Renderer.canResetView()` in 3D reports whether the camera has been moved off the default, so the
  button stays hidden until it would actually do something. Visibility is driven by `cameraMove`
  through `#updateCanResetView`, which emits `resetViewChanged` **only when the answer flips** —
  `cameraMove` fires on every frame of a drag, so emitting unconditionally would re-render the
  overlay throughout the gesture.
- `isDefaultCameraView` compares with an epsilon, and deliberately ignores `fovy`/`near`/`far`.
  The epsilon is load-bearing, not defensive: the camera handler round-trips through three.js, so
  after a reset `getCameraState().distance` comes back as `19.999999999999993`. Strict equality
  would leave the button visible forever after the first reset.
- **The overlay must re-read `canResetView()` when the renderer arrives, not just on the event.**
  `Renderer` is constructed inside a `useEffect`, so `RendererOverlay` renders once with
  `renderer === undefined` and its `useState(renderer?.canResetView() ?? false)` initializer
  resolves to `false` permanently. Since `resetViewChanged` is emitted only when the answer
  *changes*, and a layout that restores a moved camera starts out already resettable, the button
  would never appear on exactly the layouts that need it. This shipped once — the fix is the
  `useEffect` keyed on `renderer`, and `RendererOverlay.test.tsx` covers it by rendering with the
  renderer absent and then supplying it.
- `makeDefaultCameraState()` returns a deep copy. `DEFAULT_CAMERA_STATE` holds arrays and
  `updateConfig` runs through immer, which freezes what it produces — handing out the shared object
  would freeze the module-level default and break every later reset.

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
