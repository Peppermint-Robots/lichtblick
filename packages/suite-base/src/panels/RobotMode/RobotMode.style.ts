// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles<{ style?: "bulb" | "background"; backgroundColor?: string }>()(
  ({ spacing, palette }, { style, backgroundColor = "transparent" }) => ({
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
      fontSize: "clamp(9px, min(1vw, 1vh), 14px)",
      fontFamily: "monospace",
      color: palette.text.secondary,
      textAlign: "center",
      whiteSpace: "pre-wrap",
    },
  }),
);
