/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, screen } from "@testing-library/react";

import { Immutable, MessageEvent, PanelExtensionContext, RenderState } from "@lichtblick/suite";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { RobotMode, collectInputs } from "./RobotMode";
import { DEFAULT_CONFIG } from "./constants";
import { RobotModeConfig } from "./types";

type RenderFn = (renderState: Immutable<RenderState>, done: () => void) => void;

function setup(configOverride?: Partial<RobotModeConfig>) {
  const config: RobotModeConfig = { ...DEFAULT_CONFIG, ...configOverride };
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
      <RobotMode context={context} />
    </ThemeProvider>,
  );

  const emit = (messages: MessageEvent[]) => {
    act(() => {
      (context.onRender as unknown as RenderFn)(
        { currentFrame: messages } as unknown as Immutable<RenderState>,
        () => {},
      );
    });
  };

  return { context, subscribe, emit };
}

function message(topic: string, msg: unknown): MessageEvent {
  return {
    topic,
    schemaName: "test",
    receiveTime: { sec: 0, nsec: 0 },
    sizeInBytes: 0,
    message: msg,
  } as MessageEvent;
}

describe("RobotMode panel", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("subscribes to every configured topic", () => {
    const { subscribe } = setup();
    expect(subscribe).toHaveBeenCalledWith(
      expect.arrayContaining([
        { topic: "/op_speed_from_gui", preload: false },
        { topic: "/auto_mode_status", preload: false },
        { topic: "/modbus_to_gui", preload: false },
        { topic: "/initial_localization_status", preload: false },
        { topic: "/current_velocity_source", preload: false },
      ]),
    );
  });

  it("shows UNKNOWN before any message arrives", () => {
    setup();
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("UNKNOWN");
  });

  it("renders the mode from an op_speed_from_gui payload", () => {
    const { emit } = setup();
    emit([message("/op_speed_from_gui", { data: "[1.0, 0.4, 0.5, 1.0]" })]);
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("AUTO MODE");

    emit([message("/op_speed_from_gui", { data: "[1.000000,0.400000,0.500000,0.000000]" })]);
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("AUTO PAUSED");

    emit([message("/op_speed_from_gui", { data: "[0.0, 0.4, 0.5, 0.0]" })]);
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("MANUAL MODE");
  });

  it("lets a pressed e-stop from modbus_to_gui override the software mode", () => {
    const { emit } = setup();
    emit([message("/op_speed_from_gui", { data: "[1.0, 0.4, 0.5, 1.0]" })]);
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("AUTO MODE");

    // Index 6 set => e-stop pressed.
    const pressed = new Uint8Array(15);
    pressed[6] = 1;
    emit([message("/modbus_to_gui", { data: pressed })]);
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("E-STOP PRESSED");

    // Releasing it falls back to the software mode, which is still latched.
    emit([message("/modbus_to_gui", { data: new Uint8Array(15) })]);
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("AUTO MODE");
  });

  it("reports the pause button from index 10", () => {
    const { emit } = setup();
    const data = new Uint8Array(15);
    data[10] = 1;
    emit([
      message("/op_speed_from_gui", { data: "[1.0, 0.4, 0.5, 1.0]" }),
      message("/modbus_to_gui", { data }),
    ]);
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("PAUSE BUTTON");
  });

  it("shows auto-localization while the status topic reports INPROGRESS", () => {
    const { emit } = setup();
    emit([
      message("/op_speed_from_gui", { data: "[0.0, 0.4, 0.5, 0.0]" }),
      message("/initial_localization_status", { state: 1 }),
    ]);
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("AUTO LOCALIZATION");
  });

  it("renders the derived detail line", () => {
    const { emit } = setup();
    emit([message("/op_speed_from_gui", { data: "[2.0, 0.4, 0.5, 0.0]" })]);
    expect(screen.getByTestId("robot-mode-label").textContent).toContain("TELEOP");
    expect(screen.getByTestId("robot-mode-details").textContent).toContain("mode=TELEOP");
  });

  it("hides the detail line when disabled", () => {
    setup({ showDetails: false });
    expect(screen.queryByTestId("robot-mode-details")).toBeNull();
  });
});

describe("collectInputs", () => {
  it("reads modbus flags from a plain array as well as a typed array", () => {
    const data = new Array(15).fill(0);
    data[6] = 1;
    const inputs = collectInputs(DEFAULT_CONFIG, { "/modbus_to_gui": { data } });
    expect(inputs.estop).toBe(1);
    expect(inputs.pauseButton).toBe(0);
  });

  it("returns undefined for a short modbus array rather than guessing", () => {
    const inputs = collectInputs(DEFAULT_CONFIG, { "/modbus_to_gui": { data: new Uint8Array(3) } });
    expect(inputs.estop).toBeUndefined();
    expect(inputs.pauseButton).toBeUndefined();
  });

  it("honours renamed topics from the config", () => {
    const config = { ...DEFAULT_CONFIG, opSpeedTopic: "/SD0452000/op_speed_from_gui" };
    const inputs = collectInputs(config, {
      "/SD0452000/op_speed_from_gui": { data: "[1.0, 0.4, 0.5, 1.0]" },
    });
    expect(inputs.mode).toBe(1);
    expect(inputs.autoStarted).toBe(1);
  });
});
