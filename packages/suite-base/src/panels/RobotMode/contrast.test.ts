// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * The detail line under the mode label is drawn on top of the mode color. Using a fixed grey (the
 * theme's `text.secondary`) made it unreadable on the lighter modes — on the pause-button orange it
 * came out at 1.02:1, effectively invisible. The panel now derives the text color from the mode
 * color, so this guards the property that made the original choice wrong.
 */
import { getContrastRatio } from "@mui/material";

import { MODE_DESCRIPTORS } from "./deriveRobotMode";
import { RobotModeId } from "./types";

/** How MUI picks contrastText: white unless it fails against the background. */
function contrastText(background: string): string {
  return getContrastRatio(background, "#ffffff") >= 3 ? "#ffffff" : "rgba(0, 0, 0, 0.87)";
}

describe("robot mode colors", () => {
  const ids = Object.keys(MODE_DESCRIPTORS) as RobotModeId[];

  it.each(ids)("keeps the detail line readable on the %s background", (id) => {
    const { color } = MODE_DESCRIPTORS[id];
    expect(getContrastRatio(color, contrastText(color))).toBeGreaterThanOrEqual(3);
  });

  it("would have failed with the previous fixed grey on at least one mode", () => {
    // Sanity check that the test above is actually load-bearing rather than trivially true.
    const worst = Math.min(
      ...ids.map((id) => getContrastRatio(MODE_DESCRIPTORS[id].color, "#aaaaaa")),
    );
    expect(worst).toBeLessThan(3);
  });

  it("gives every mode a distinct color", () => {
    const colors = ids.map((id) => MODE_DESCRIPTORS[id].color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
