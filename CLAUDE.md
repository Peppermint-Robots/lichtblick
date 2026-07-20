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
