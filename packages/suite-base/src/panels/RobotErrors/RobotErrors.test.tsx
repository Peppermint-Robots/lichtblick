/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen } from "@testing-library/react";

import { privateErrorCodeFixture } from "@lichtblick/private-layouts";
import { Immutable, PanelExtensionContext, RenderState } from "@lichtblick/suite";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { RobotErrors } from "./RobotErrors";
import { DEFAULT_CONFIG } from "./constants";
import { RobotErrorsConfig } from "./types";

type RenderFn = (renderState: Immutable<RenderState>, done: () => void) => void;

const TOPIC = "/error_codes_list";

function setup(configOverride?: Partial<RobotErrorsConfig>) {
  const config: RobotErrorsConfig = { ...DEFAULT_CONFIG, ...configOverride };
  const subscribe = jest.fn();
  const context = {
    initialState: config,
    onRender: undefined as undefined | RenderFn,
    panelElement: document.createElement("div"),
    saveState: jest.fn(),
    setDefaultPanelTitle: jest.fn(),
    subscribe,
    unsubscribeAll: jest.fn(),
    updatePanelSettingsEditor: jest.fn(),
    watch: jest.fn(),
  } as unknown as PanelExtensionContext;

  render(
    <ThemeProvider isDark>
      <RobotErrors context={context} />
    </ThemeProvider>,
  );

  const emit = (data: string, atSeconds = 0) => {
    act(() => {
      (context.onRender as unknown as RenderFn)(
        {
          currentTime: { sec: Math.floor(atSeconds), nsec: Math.round((atSeconds % 1) * 1e9) },
          currentFrame: [
            {
              topic: TOPIC,
              schemaName: "std_msgs/String",
              receiveTime: { sec: Math.floor(atSeconds), nsec: 0 },
              sizeInBytes: 0,
              message: { data },
            },
          ],
        },
        () => {},
      );
    });
  };

  /** Advance (or rewind) the playhead without publishing a new message. */
  const tick = (atSeconds: number) => {
    act(() => {
      (context.onRender as unknown as RenderFn)(
        {
          currentTime: { sec: Math.floor(atSeconds), nsec: Math.round((atSeconds % 1) * 1e9) },
        },
        () => {},
      );
    });
  };

  return { context, subscribe, emit, tick };
}

describe("RobotErrors panel", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("subscribes to the configured topic", () => {
    const { subscribe } = setup();
    expect(subscribe).toHaveBeenCalledWith([{ topic: TOPIC, preload: false }]);
  });

  it("distinguishes 'no message yet' from 'no active errors'", () => {
    const { emit } = setup();
    expect(screen.getByTestId("robot-errors-empty").textContent).toContain("Waiting for");

    emit('{"error":[],"warnings":[]}');
    expect(screen.getByTestId("robot-errors-empty").textContent).toContain("No active errors");
  });

  it("lists every active error with its code and catalog title", () => {
    const { emit } = setup({
      catalogOverride: JSON.stringify({ E001: { title: "Test Fault" } }),
    });
    emit('{"error":["E001","E002"],"warnings":["W002"]}');

    expect(screen.getByTestId("robot-errors-count").textContent).toContain("2 Errors");
    expect(screen.getByTestId("robot-errors-item-E001").textContent).toContain("Test Fault");
    expect(screen.getByTestId("robot-errors-item-E002")).toBeDefined();
    // The warnings array must not leak into the errors panel.
    expect(screen.queryByTestId("robot-errors-item-W002")).toBeNull();
  });

  it("shows the warnings list when configured as a warnings panel", () => {
    const { emit } = setup({ severity: "warning" });
    emit('{"error":["E001"],"warnings":["W001","W002"]}');

    expect(screen.getByTestId("robot-errors-count").textContent).toContain("2 Warnings");
    expect(screen.getByTestId("robot-errors-item-W002")).toBeDefined();
    expect(screen.queryByTestId("robot-errors-item-E001")).toBeNull();
  });

  it("clears an error when it drops out of the snapshot", () => {
    const { emit } = setup();
    emit('{"error":["E001","E002"],"warnings":[]}');
    expect(screen.getByTestId("robot-errors-item-E002")).toBeDefined();

    // The list is a full snapshot, so a code that disappears has cleared.
    emit('{"error":["E001"],"warnings":[]}');
    expect(screen.queryByTestId("robot-errors-item-E002")).toBeNull();
    expect(screen.getByTestId("robot-errors-item-E001")).toBeDefined();
  });

  it("keeps the last good state when a malformed payload arrives", () => {
    const { emit } = setup();
    emit('{"error":["E001"],"warnings":[]}');
    emit("not json at all");
    expect(screen.getByTestId("robot-errors-item-E001")).toBeDefined();
  });

  it("still lists a code the bundled catalog does not know", () => {
    const { emit } = setup();
    emit('{"error":["X999"],"warnings":[]}');
    const item = screen.getByTestId("robot-errors-item-X999");
    expect(item.textContent).toContain("X999");
    expect(item.textContent).toContain("Not in this build");
  });

  it("prefers an override catalog over the bundled text", () => {
    const { emit } = setup({
      catalogOverride: JSON.stringify({
        X999: { title: "Brand New Fault", description: "Do the new thing" },
      }),
    });
    emit('{"error":["X999"],"warnings":[]}');
    const item = screen.getByTestId("robot-errors-item-X999");
    expect(item.textContent).toContain("Brand New Fault");
    expect(item.textContent).not.toContain("Not in this build");
  });

  it("accepts the robot's own robot_errors.json shape as an override", () => {
    const { emit } = setup({
      catalogOverride: JSON.stringify({
        X999: { error: "Some Headline", errorDesc: "Some guidance" },
      }),
    });
    emit('{"error":["X999"],"warnings":[]}');
    expect(screen.getByTestId("robot-errors-item-X999").textContent).toContain("Some Headline");
  });

  it("hides guidance text when disabled", () => {
    const { emit } = setup({
      showDescriptions: false,
      catalogOverride: JSON.stringify({
        E001: { title: "Test Fault", description: "test remediation steps" },
      }),
    });
    emit('{"error":["E001"],"warnings":[]}');
    const item = screen.getByTestId("robot-errors-item-E001");
    expect(item.textContent).toContain("Test Fault");
    expect(item.textContent).not.toContain("test remediation steps");
  });

  it("ages an error by playback time, not wall-clock", () => {
    const { emit, tick } = setup();
    emit('{"error":["E001"],"warnings":[]}', 100);
    const age = () =>
      screen.getByTestId("robot-errors-item-E001").querySelector('[data-testid="robot-errors-age"]')
        ?.textContent;
    expect(age()).toBe("0s");

    tick(105);
    expect(age()).toBe("5s");
    tick(190);
    expect(age()).toBe("1m 30s");
  });

  it("freezes the age while playback is paused", () => {
    const { emit, tick } = setup();
    emit('{"error":["E001"],"warnings":[]}', 10);
    tick(40);
    const age = () =>
      screen.getByTestId("robot-errors-item-E001").querySelector('[data-testid="robot-errors-age"]')
        ?.textContent;
    expect(age()).toBe("30s");

    // A paused player re-renders at the same currentTime; the age must not creep.
    tick(40);
    tick(40);
    expect(age()).toBe("30s");
  });

  it("restarts the age when an error clears and comes back", () => {
    const { emit, tick } = setup();
    emit('{"error":["E001"],"warnings":[]}', 10);
    tick(40);
    const age = () =>
      screen.getByTestId("robot-errors-item-E001").querySelector('[data-testid="robot-errors-age"]')
        ?.textContent;
    expect(age()).toBe("30s");

    emit('{"error":[],"warnings":[]}', 45);
    emit('{"error":["E001"],"warnings":[]}', 50);
    expect(age()).toBe("0s");
    tick(53);
    expect(age()).toBe("3s");
  });

  it("does not show a negative age after scrubbing backwards", () => {
    const { emit, tick } = setup();
    emit('{"error":["E001"],"warnings":[]}', 300);
    tick(120);
    const age = screen
      .getByTestId("robot-errors-item-E001")
      .querySelector('[data-testid="robot-errors-age"]')?.textContent;
    expect(age).toBe("0s");
  });
});

// The recording lives in the proprietary submodule; jest resolves that alias to the empty stub, and
// an open-source checkout has no recording at all, so this block skips itself rather than failing.
// Run it against the real data with the private moduleNameMapper (see the submodule's CLAUDE.md).
const describeWithRecording = privateErrorCodeFixture.length > 0 ? describe : describe.skip;

describeWithRecording("RobotErrors against the recorded error_codes_list capture", () => {
  // Typed explicitly: eslint/tsc resolve the alias to the empty stub, where the array element type
  // would otherwise be inferred as `never`.
  const transitions: { t: number; data: string }[] = privateErrorCodeFixture;

  /** Codes are read out of the recording at runtime — this repository is public, so no real
   * Peppermint error code is written down here. The recording lives in the private submodule. */
  const codesIn = (severity: "error" | "warnings"): string[] => {
    const seen = new Set<string>();
    for (const entry of transitions) {
      for (const code of (JSON.parse(entry.data) as Record<string, string[]>)[severity] ?? []) {
        seen.add(code);
      }
    }
    return [...seen];
  };

  it("renders every payload in the recording without losing the error list", () => {
    const { emit } = setup();
    const counts = new Set<string>();

    for (const entry of transitions) {
      emit(entry.data);
      counts.add(screen.getByTestId("robot-errors-count").textContent);
    }

    // The recording alternates between one error and two (a heartbeat dropping out and recovering),
    // so the panel must have shown both list lengths and never gone empty.
    expect(counts).toEqual(new Set(["1 Errors", "2 Errors"]));
  });

  it("ages a persistent warning by the recording's own timeline", () => {
    // The first warning in the recording is present in the very first payload and never clears, so
    // at the end its age must equal the recording's elapsed time — proof the age tracks bag time
    // rather than however long the test took to run.
    const persistent = (JSON.parse(transitions[0]!.data) as { warnings: string[] }).warnings[0]!;
    const { emit } = setup({ severity: "warning" });
    for (const entry of transitions) {
      emit(entry.data, entry.t);
    }
    const age = screen
      .getByTestId(`robot-errors-item-${persistent}`)
      .querySelector('[data-testid="robot-errors-age"]')?.textContent;

    const elapsed = Math.floor(transitions[transitions.length - 1]!.t - transitions[0]!.t);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    expect(age).toBe(`${minutes}m ${String(seconds).padStart(2, "0")}s`);
  });

  it("shows every warning the recording carries, throughout", () => {
    const warnings = codesIn("warnings");
    expect(warnings.length).toBeGreaterThan(0);

    const { emit } = setup({ severity: "warning" });
    for (const entry of transitions) {
      emit(entry.data);
    }
    expect(screen.getByTestId("robot-errors-count").textContent).toContain(
      `${warnings.length} Warnings`,
    );
    for (const code of warnings) {
      expect(screen.getByTestId(`robot-errors-item-${code}`)).toBeDefined();
    }
  });
});
