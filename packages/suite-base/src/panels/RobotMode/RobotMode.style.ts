// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles<{
  style?: "bulb" | "background";
  backgroundColor?: string;
}>()((theme, { style, backgroundColor = "transparent" }) => {
  const { spacing, palette } = theme;

  // In "background" style the panel is filled with the mode color, which ranges from a dark e-stop
  // red to a bright orange/yellow, so the theme's fixed grey secondary text is unreadable on the
  // light ones — on the pause-button orange it comes out at a 1.02:1 contrast ratio, i.e. invisible.
  // Take the same contrastText MUI computes for the mode color, which keeps every mode above 3:1.
  // The detail line is kept subordinate to the mode label by weight and size, not by fading, since
  // fading is what destroyed the contrast in the first place.
  const detailColor =
    style === "background"
      ? palette.augmentColor({ color: { main: backgroundColor } }).contrastText
      : palette.text.secondary;

  return {
    root: {
      flexGrow: 1,
      justifyContent: "center",
      alignItems: "center",
      overflow: "hidden",
      padding: spacing(1),
      gap: spacing(0.5),
      backgroundColor: style === "background" ? backgroundColor : "transparent",
    },
    modeRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing(1),
      display: "flex",
    },
    bulb: {
      width: "clamp(10px, 2vw, 32px)",
      height: "clamp(10px, 2vw, 32px)",
      borderRadius: "50%",
      flexShrink: 0,
      backgroundColor,
      backgroundImage: [
        `radial-gradient(transparent, transparent 55%, rgba(255,255,255,0.4) 80%, rgba(255,255,255,0.4))`,
        `radial-gradient(circle at 38% 35%, rgba(255,255,255,0.8), transparent 30%, transparent)`,
        `radial-gradient(circle at 46% 44%, transparent, transparent 61%, rgba(0,0,0,0.7) 74%, rgba(0,0,0,0.7))`,
      ].join(","),
    },
    label: {
      fontWeight: 700,
      fontSize: "clamp(12px, min(2vw, 2vh), 52px)",
      whiteSpace: "pre",
      textAlign: "center",
    },
    details: {
      fontSize: "clamp(10px, min(1.1vw, 1.1vh), 15px)",
      fontFamily: "monospace",
      fontWeight: 500,
      color: detailColor,
      textAlign: "center",
      whiteSpace: "pre-wrap",
    },
  };
});
