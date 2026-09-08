// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Each entry sits on a faint wash of its severity color, so text on it cannot use the theme's flat
 * text colors: those are calibrated against `background.paper`, not against a tint. Using them
 * unmodified produced two real failures — the warning orange as code text scored 1.90:1 on the
 * light theme, and the error red 3.22:1 on the dark theme.
 *
 * These cases pin the colors the panel actually derives, in both themes.
 */
import { alpha, darken, getContrastRatio, lighten } from "@mui/material";

const ACCENTS = { errors: "#e62b4d", warnings: "#f5a623" };

// Mirrors RobotErrors.style.ts: the wash is mixed into background.paper to an OPAQUE color, and
// the text color is whatever contrasts with that — white on dark, black on light.
const THEMES = {
  dark: { paper: "#27272b", washAlpha: 0.16, onWash: "#ffffff" },
  light: { paper: "#ffffff", washAlpha: 0.11, onWash: "#000000" },
};

/** Flatten a translucent layer onto an opaque backdrop, as the browser composites it. */
function composite(foreground: string, opacity: number, background: string): string {
  const parse = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [fr, fg, fb] = parse(foreground) as [number, number, number];
  const [br, bg, bb] = parse(background) as [number, number, number];
  const mix = (f: number, b: number) => Math.round(f * opacity + b * (1 - opacity));
  return `#${[mix(fr, br), mix(fg, bg), mix(fb, bb)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Same derivation as RobotErrors.style.ts. */
function derive(themeName: keyof typeof THEMES, accent: string) {
  const theme = THEMES[themeName];
  const wash = composite(accent, theme.washAlpha, theme.paper);
  const accentText = themeName === "dark" ? lighten(accent, 0.25) : darken(accent, 0.35);
  return {
    wash,
    code: accentText,
    title: theme.onWash,
    description: composite(theme.onWash, 0.85, wash),
    age: composite(theme.onWash, 0.7, wash),
  };
}

describe("RobotErrors readability", () => {
  const cases = Object.keys(THEMES).flatMap((themeName) =>
    Object.entries(ACCENTS).map(([severity, accent]) => ({
      themeName: themeName as keyof typeof THEMES,
      severity,
      accent,
    })),
  );

  it.each(cases)("keeps $severity text readable on the $themeName theme", ({ themeName, accent }) => {
    const { wash, code, title, description, age } = derive(themeName, accent);

    // 4.5:1 is WCAG AA for body text; the code and age are bold/short so 3:1 applies, but hold
    // them to 4 anyway since they carry the identifying information.
    expect(getContrastRatio(code, wash)).toBeGreaterThanOrEqual(4);
    expect(getContrastRatio(title, wash)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(description, wash)).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(age, wash)).toBeGreaterThanOrEqual(4.5);
  });

  it("would have failed with the flat theme colors it replaced", () => {
    // Guards against someone reverting to palette.text.secondary / a raw accent.
    const lightWash = composite(ACCENTS.warnings, 0.11, "#ffffff");
    expect(getContrastRatio(ACCENTS.warnings, lightWash)).toBeLessThan(3);

    const darkWash = composite(ACCENTS.errors, 0.16, "#27272b");
    expect(getContrastRatio(ACCENTS.errors, darkWash)).toBeLessThan(4);
  });

  it("keeps the two severities visually distinct", () => {
    expect(alpha(ACCENTS.errors, 1)).not.toEqual(alpha(ACCENTS.warnings, 1));
  });
});
