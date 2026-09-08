/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Checks the colors the panel actually paints, rather than a re-derivation of the formula.
 *
 * The earlier bug this guards against: the item background was `alpha(accent, …)`, i.e. translucent.
 * `getContrastText` was then asked about `background.paper` instead of the color really behind the
 * text, and picked white on the light theme — where black is needed. Reading the computed styles
 * off the rendered DOM is the only way to catch that class of mistake.
 */
import { act, render, screen } from "@testing-library/react";

import { Immutable, PanelExtensionContext, RenderState } from "@lichtblick/suite";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { RobotErrors } from "./RobotErrors";
import { DEFAULT_CONFIG } from "./constants";
import { RobotErrorsConfig } from "./types";

type RenderFn = (renderState: Immutable<RenderState>, done: () => void) => void;

function parseRgb(value: string): [number, number, number] {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) {
    throw new Error(`not an rgb color: ${value}`);
  }
  const parts = match[1]!.split(",").map((part) => parseFloat(part.trim()));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Perceived lightness, 0 (black) to 1 (white). */
function luminance(color: string): number {
  const toLinear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = parseRgb(color);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function renderPanel({
  isDark,
  configOverride,
}: {
  isDark: boolean;
  configOverride?: Partial<RobotErrorsConfig>;
}) {
  const config: RobotErrorsConfig = {
    ...DEFAULT_CONFIG,
    // The bundled catalog is proprietary and absent under jest, so these tests bring their own
    // text — they are about color, not about catalog contents.
    catalogOverride: JSON.stringify({
      E001: { title: "Test Fault", description: "Test remediation steps" },
      W002: { title: "Test Warning", description: "Test warning detail" },
    }),
    ...configOverride,
  };
  const context = {
    initialState: config,
    onRender: undefined as undefined | RenderFn,
    panelElement: document.createElement("div"),
    saveState: jest.fn(),
    setDefaultPanelTitle: jest.fn(),
    subscribe: jest.fn(),
    unsubscribeAll: jest.fn(),
    updatePanelSettingsEditor: jest.fn(),
    watch: jest.fn(),
  } as unknown as PanelExtensionContext;

  render(
    <ThemeProvider isDark={isDark}>
      <RobotErrors context={context} />
    </ThemeProvider>,
  );

  act(() => {
    (context.onRender as unknown as RenderFn)(
      {
        currentFrame: [
          {
            topic: DEFAULT_CONFIG.topic,
            schemaName: "std_msgs/String",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: { data: '{"error":["E001"],"warnings":["W002"]}' },
          },
        ],
      },
      () => {},
    );
  });
}

describe("RobotErrors rendered colors", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    { theme: "light", isDark: false, severity: "error" as const },
    { theme: "light", isDark: false, severity: "warning" as const },
    { theme: "dark", isDark: true, severity: "error" as const },
    { theme: "dark", isDark: true, severity: "warning" as const },
  ])("paints an opaque item background on the $theme theme ($severity)", ({ isDark, severity }) => {
    renderPanel({ isDark, configOverride: { severity } });
    const item = screen.getByTestId(
      severity === "warning" ? "robot-errors-item-W002" : "robot-errors-item-E001",
    );
    const background = getComputedStyle(item).backgroundColor;

    // A translucent fill is the bug this suite exists for: contrast cannot be reasoned about when
    // the real backdrop is whatever sits behind the panel.
    expect(background).not.toMatch(/rgba\([^)]+,\s*0?\.\d+\)/);
    expect(background).toMatch(/^rgb\(/);
  });

  it.each([
    // The light theme's wash is near-white, so the text has to be dark; the dark theme's is a deep
    // maroon, so it has to be light. The bug was that both rendered near-white text.
    { theme: "light", isDark: false, expectDarkText: true },
    { theme: "dark", isDark: true, expectDarkText: false },
  ])(
    "uses text that contrasts with the item background on the $theme theme",
    ({ isDark, expectDarkText }) => {
      renderPanel({ isDark });
      const item = screen.getByTestId("robot-errors-item-E001");
      const background = luminance(getComputedStyle(item).backgroundColor);

      const description = item.querySelector('[data-testid="robot-errors-description"]');
      expect(description).not.toBeNull();
      const text = luminance(getComputedStyle(description!).color);

      // Background and text must sit on opposite sides of mid-grey.
      expect(background > 0.5).toBe(expectDarkText);
      expect(text < 0.3).toBe(expectDarkText);
    },
  );
});
