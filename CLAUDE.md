# Lichtblick (Peppermint fork)

Peppermint's fork of Lichtblick (Foxglove Studio). Shipped two ways from the **same** source:

- **Desktop** (`packages/suite-desktop`, entry `packages/suite-desktop/src/renderer/Root.tsx` →
  `App` → `Workspace`) — used for internal development.
- **Web** (`packages/suite-web`, entry `packages/suite-web/src/WebRoot.tsx` → `SharedRoot` →
  `StudioApp` → `Workspace`) — a static bundle that a host application can embed.

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
  bundle, or `?layoutsUrl=`), so a host application can override/extend layouts without a rebuild.
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
any layouts from the private submodule, plus anything saved locally). There is deliberately no
layout control in the app bar: `AppBar` renders `appBarLayoutButton` from `useAppContext`, and
neither the desktop nor the web entry point supplies one, so that slot is empty. The
`Workspace.tsx` sidebar entry guarded by `if (!enableNewTopNav)` is the *old* nav's duplicate of the
same browser, not a second feature — desktop runs with the new top nav, so the left-sidebar tab is
the only route. If someone reports that layout switching "disappeared", check that tab before
suspecting a regression.

## Proprietary layouts and panels (git submodule)

`packages/suite-base/src/layouts/private/` is a **git submodule** pointing at a private repository
(URL in `.gitmodules`), kept out of this MPL-2.0 repo. Consumed via
the `@lichtblick/private-layouts` alias, resolved in `packages/suite-base/webpack.ts` (`makeConfig`,
used by both web and desktop webpack) with a `noPrivateLayouts.ts` fallback, exporting empty lists,
when the submodule is absent. The alias is mirrored across several tsconfigs + jest configs — see
the submodule's own `CLAUDE.md` for the full mirror list and authoring workflow. Never move a layout
JSON, a proprietary panel, or anything naming proprietary topics into this repo.

- `privateLayouts` are spread into `bundledLayouts` (see above).
- `privatePanels` (`PanelInfo[]`) are appended to the built-in panels in `src/panels/index.ts`.
  Their `type` strings are persisted in layouts, so the submodule owns and must never rename them.
- Every export the submodule adds needs a matching empty export in `noPrivateLayouts.ts`, or a
  checkout without the submodule stops building. Jest always maps the alias to that stub.
- After `git pull`, run `git submodule update` so the checkout matches the pinned commit.

**Squash-merge caveat.** `main` on the private repo is protected, so changes there go through a PR
on a branch — and the team squash-merges, which lands the change on `main` under a **new SHA**. A
pointer committed here that still names the pre-merge commit breaks once GitHub deletes the merged
branch: a fresh `clone --recurse-submodules` then fails with "reference is not a tree". After the PR
merges, run `scripts/repoint-private-layouts.sh` and push the fork. It checks that the merged `main`
has the identical tree before re-pointing (a squash changes the SHA, never the tree) and refuses if
`main` has moved on beyond your PR, so it cannot silently absorb someone else's change.

Fork tooling must never rewrite files inside the submodule: `eslint.config.mjs` turns
`@lichtblick/license-header` off for `layouts/private/**` (`yarn lint` runs with `--fix`, which would
otherwise stamp the MPL header onto proprietary files) and `biome.json` excludes the directory.

## Automatic robot-namespace handling — works on BOTH builds

Robot topics are commonly namespaced `/<robot_id>/<topic>`. Layouts are authored against whatever robot
was on hand, then adapted to the connected robot at runtime — **no `$variable` topics** (Lichtblick's
message-path grammar forbids variables in the topic-name position).

- `packages/suite-base/src/components/RobotNamespaceLayoutAdapter.tsx` is mounted in
  `Workspace.tsx`, **inside** `PanelStateContextProvider`. Because `Workspace` is shared, this runs
  identically on desktop and web.
- `packages/suite-base/src/util/robotNamespaceLayout.ts`: `detectRobotNamespace` picks the most
  common first path segment (denylist: `diagnostics`, `rosout`, `parameter_events`, `clock`;
  overridable via the `robot_id` global variable), and `rewriteConfigTopics` recursively rewrites
  topic references in every panel config to the connected robot's namespace. A reference whose
  first segment looks like a robot ID (all-uppercase alphanumeric with digits, e.g. `AB0000001`)
  is re-namespaced even when the connected source lacks that topic — the panel then shows the
  current robot's topic name and binds if the topic appears later on a live connection. Generic
  references (`/odom`) and functional first segments (`/move_base_simple/...`) are only rewritten
  when the target topic actually exists.
- Runs for any data source (MCAP bag or live connection) and any layout, not just the bundled ones.

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

## 3D panel: reset view

Upstream ships a "Reset view" button in `RendererOverlay`, but it was wired only to image mode —
`canResetView()` returned `imageModeExtension?.hasModifiedView() ?? false`, which is always `false`
in 3D, so the button never appeared. Layouts that use `followMode: "follow-none"` with a fixed
display frame leave no way back after panning away, other than hunting for the scene by hand; the
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
`FoxgloveWebSocketPlayer`) — this fork intentionally views high-rate topics.
