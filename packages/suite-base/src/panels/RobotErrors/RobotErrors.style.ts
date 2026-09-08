// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha, darken, decomposeColor, lighten, recomposeColor } from "@mui/material";
import { makeStyles } from "tss-react/mui";

/**
 * Blend `foreground` into `background` at `weight`, returning an **opaque** color.
 *
 * `alpha()` would return a translucent color instead, which composites over whatever is behind the
 * element at paint time — so the rendered background would be unknown and `getContrastText` could
 * not make a correct black-or-white decision about text drawn on it.
 */
function mix(foreground: string, background: string, weight: number): string {
  const fg = decomposeColor(foreground).values;
  const bg = decomposeColor(background).values;
  const channel = (index: number) =>
    Math.round((fg[index] ?? 0) * weight + (bg[index] ?? 0) * (1 - weight));
  return recomposeColor({
    type: "rgb",
    values: [channel(0), channel(1), channel(2)],
  });
}

export const useStyles = makeStyles<{ accent: string }>()((
  theme,
  { accent },
) => {
  const { spacing, palette } = theme;

  // Each entry sits on a faint wash of its accent color. The wash must be an **opaque** color, not
  // `alpha(accent, …)`: a translucent fill composites over whatever happens to be behind the panel,
  // so the actual rendered background is unknown and any contrast decision made against it is a
  // guess. Mixing the accent into the panel's own background up front gives a concrete color, which
  // is what `getContrastText` then picks black-or-white against — the same thing the Indicator and
  // Robot Mode panels do with their (already opaque) fills.
  const wash =
    palette.mode === "dark"
      ? mix(accent, palette.background.paper, 0.16)
      : mix(accent, palette.background.paper, 0.11);
  const onWash = palette.getContrastText(wash);
  // Pull the accent toward the text color so it stays recognisably the severity color while
  // clearing the readability bar for small monospace text.
  const accentText =
    palette.mode === "dark" ? lighten(accent, 0.25) : darken(accent, 0.35);

  return {
    root: {
      flexGrow: 1,
      overflowY: "auto",
      overflowX: "hidden",
      padding: spacing(0.5),
      gap: spacing(0.5),
    },
    empty: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      color: palette.text.secondary,
      fontSize: "0.85rem",
      padding: spacing(2),
      textAlign: "center",
    },
    countRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing(1),
      padding: spacing(0.25, 0.75),
      position: "sticky",
      top: 0,
      zIndex: 1,
      backgroundColor: palette.background.paper,
      borderBottom: `1px solid ${palette.divider}`,
    },
    countLabel: {
      fontWeight: 700,
      fontSize: "0.75rem",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: accentText,
    },
    item: {
      // A left accent bar rather than a filled background: several errors are usually active at once,
      // and solid fills at that density are unreadable.
      borderLeft: `3px solid ${accent}`,
      backgroundColor: wash,
      borderRadius: 2,
      padding: spacing(0.5, 0.75),
      gap: spacing(0.25),
    },
    itemUnknown: {
      borderLeftStyle: "dashed",
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: spacing(0.75),
      display: "flex",
    },
    code: {
      fontFamily: "monospace",
      fontWeight: 700,
      fontSize: "0.8rem",
      color: accentText,
      flexShrink: 0,
    },
    title: {
      fontWeight: 600,
      fontSize: "0.82rem",
      color: onWash,
      flexGrow: 1,
      minWidth: 0,
      wordBreak: "break-word",
    },
    age: {
      fontFamily: "monospace",
      fontSize: "0.72rem",
      color: alpha(onWash, 0.7),
      flexShrink: 0,
    },
    description: {
      fontSize: "0.78rem",
      // Calibrated against the washed item background, not background.paper: the flat
      // text.secondary reads faint on top of the tint.
      color: alpha(onWash, 0.85),
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    },
    unknownNote: {
      fontSize: "0.72rem",
      fontStyle: "italic",
      color: alpha(onWash, 0.85),
    },
  };
});
