// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { deriveRobotMode, parseOpSpeed } from "./deriveRobotMode";

describe("parseOpSpeed", () => {
  it("parses the C++ std::to_string form emitted by state_manager", () => {
    expect(parseOpSpeed("[1.000000,0.400000,0.500000,1.000000]")).toEqual([1, 0.4, 0.5, 1]);
  });

  it("parses the strict JSON form emitted by the mqtt/FMS clients", () => {
    expect(parseOpSpeed("[1.0, 0.4, 0.5, 1.0]")).toEqual([1, 0.4, 0.5, 1]);
  });

  it("parses a payload with mixed spacing", () => {
    expect(parseOpSpeed("[0.0, 0.300000, 0.5, 0.0]")).toEqual([0, 0.3, 0.5, 0]);
  });

  it("parses negative manual speeds", () => {
    expect(parseOpSpeed("[0.0,-0.500000,0.500000,0.000000]")).toEqual([0, -0.5, 0.5, 0]);
  });

  it("tolerates a payload without brackets", () => {
    expect(parseOpSpeed("1.0,0.4,0.5,1.0")).toEqual([1, 0.4, 0.5, 1]);
  });

  it("returns undefined for malformed or short payloads", () => {
    expect(parseOpSpeed(undefined)).toBeUndefined();
    expect(parseOpSpeed("")).toBeUndefined();
    expect(parseOpSpeed("[]")).toBeUndefined();
    expect(parseOpSpeed("[1.0, 0.4, 0.5]")).toBeUndefined();
    expect(parseOpSpeed("[1.0, abc, 0.5, 1.0]")).toBeUndefined();
  });
});

describe("deriveRobotMode", () => {
  it("reports the software mode when nothing is pressed", () => {
    expect(deriveRobotMode({ mode: 0 }).id).toBe("manual");
    expect(deriveRobotMode({ mode: 2 }).id).toBe("teleop");
    expect(deriveRobotMode({ mode: 3 }).id).toBe("auto_localization");
  });

  it("splits auto into play and paused using auto_started", () => {
    expect(deriveRobotMode({ mode: 1, autoStarted: 1 }).id).toBe("auto_play");
    expect(deriveRobotMode({ mode: 1, autoStarted: 0 }).id).toBe("auto_paused");
  });

  it("falls back to auto_mode_status for the play flag when op_speed lacks it", () => {
    expect(deriveRobotMode({ mode: 1, autoModeStatus: 1 }).id).toBe("auto_play");
    expect(deriveRobotMode({ mode: 1, autoModeStatus: 0 }).id).toBe("auto_paused");
  });

  it("prefers auto_started over auto_mode_status when both are present", () => {
    expect(deriveRobotMode({ mode: 1, autoStarted: 0, autoModeStatus: 1 }).id).toBe("auto_paused");
  });

  it("lets a pressed e-stop override every software mode", () => {
    expect(deriveRobotMode({ mode: 1, autoStarted: 1, estop: 1 }).id).toBe("estop");
    expect(deriveRobotMode({ mode: 0, estop: 1 }).id).toBe("estop");
    expect(deriveRobotMode({ mode: 3, estop: 1, pauseButton: 1 }).id).toBe("estop");
  });

  it("reports the pause button below e-stop but above software modes", () => {
    expect(deriveRobotMode({ mode: 1, autoStarted: 1, pauseButton: 1 }).id).toBe("pause_button");
    expect(deriveRobotMode({ mode: 1, autoStarted: 1, estop: 0, pauseButton: 0 }).id).toBe(
      "auto_play",
    );
  });

  it("detects auto-localization from the status topic before the mode field changes", () => {
    expect(deriveRobotMode({ mode: 0, localizationState: 1 }).id).toBe("auto_localization");
    // INACTIVE / SUCCESS / FAILED must not trigger it.
    expect(deriveRobotMode({ mode: 0, localizationState: -1 }).id).toBe("manual");
    expect(deriveRobotMode({ mode: 0, localizationState: 0 }).id).toBe("manual");
    expect(deriveRobotMode({ mode: 0, localizationState: 2 }).id).toBe("manual");
  });

  it("detects teleop from the velocity mux when the mode field says manual", () => {
    expect(deriveRobotMode({ mode: 0, velocitySource: "teleop_cmd_vel" }).id).toBe("teleop");
    expect(deriveRobotMode({ mode: 0, velocitySource: "stop_cmd_vel" }).id).toBe("manual");
  });

  it("tolerates float jitter in the mode field", () => {
    expect(deriveRobotMode({ mode: 0.999999, autoStarted: 1 }).id).toBe("auto_play");
    expect(deriveRobotMode({ mode: 2.000001 }).id).toBe("teleop");
  });

  it("reports unknown until something arrives", () => {
    expect(deriveRobotMode({}).id).toBe("unknown");
    // auto_mode_status alone can only ever prove auto-play.
    expect(deriveRobotMode({ autoModeStatus: 1 }).id).toBe("auto_play");
    expect(deriveRobotMode({ autoModeStatus: 0 }).id).toBe("unknown");
  });
});
