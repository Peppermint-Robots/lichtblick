// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Replays a real recording through the derivation to check the panel against the robot rather than
 * against synthetic fixtures.
 *
 * The recording (auto localization -> manual -> auto cleaning -> GUI pause -> e-stop -> physical
 * pause button) is a capture off a real robot, so it lives in the private-layouts submodule and
 * reaches this test through the `@lichtblick/private-layouts` alias. Jest maps that alias to the
 * empty stub, so this block skips itself unless pointed at the submodule; see its CLAUDE.md.
 * Regenerate the fixture with the submodule's `robotMode/scripts/extractRobotModeFixture.py`.
 */
import { privateRobotModeFixture } from "@lichtblick/private-layouts";

import { deriveRobotMode } from "./deriveRobotMode";
import { RobotModeInputs } from "./types";

type Transition = {
  /** Seconds since the start of the recording. */
  t: number;
  topic: string;
  value: Record<string, unknown>;
};

/** Namespace is read from the recording rather than written down: this repository is public. */
const NS = ((privateRobotModeFixture[0]?.topic ?? "//") as string).replace(/^(\/[^/]*)\/.*$/, "$1");

/** Mirrors collectInputs, but over the reduced fixture shape. */
function applyMessage(inputs: RobotModeInputs, entry: Transition): RobotModeInputs {
  const next = { ...inputs };
  switch (entry.topic) {
    case `${NS}/op_speed_from_gui`: {
      const parsed = String(entry.value.data)
        .replace(/[[\]]/g, "")
        .split(",")
        .map((v) => Number(v.trim()));
      next.mode = parsed[0];
      next.autoStarted = parsed[3];
      break;
    }
    case `${NS}/auto_mode_status`:
      next.autoModeStatus = Number(entry.value.data);
      break;
    case `${NS}/modbus_to_gui`:
      next.estop = entry.value.estop as number;
      next.pauseButton = entry.value.pause as number;
      break;
    case `${NS}/initial_localization_status`:
      next.localizationState = entry.value.state as number;
      break;
    default:
      break;
  }
  return next;
}

const describeWithRecording = privateRobotModeFixture.length > 0 ? describe : describe.skip;

describeWithRecording("RobotMode against the recorded snapshot", () => {
  const transitions = privateRobotModeFixture as unknown as Transition[];

  it("has the topics the panel depends on", () => {
    const topics = new Set(transitions.map((entry) => entry.topic));
    expect(topics).toContain(`${NS}/op_speed_from_gui`);
    expect(topics).toContain(`${NS}/auto_mode_status`);
    expect(topics).toContain(`${NS}/modbus_to_gui`);
    expect(topics).toContain(`${NS}/initial_localization_status`);
  });

  it("produces the sequence of modes the operator actually performed", () => {
    let inputs: RobotModeInputs = {};
    const seen: string[] = [];
    for (const entry of transitions) {
      inputs = applyMessage(inputs, entry);
      const id = deriveRobotMode(inputs).id;
      if (seen[seen.length - 1] !== id) {
        seen.push(id);
      }
    }

    // Every mode the panel exists to show was reached, and nothing fell through to "unknown"
    // after the first payload arrived.
    expect(new Set(seen)).toEqual(
      new Set([
        "unknown",
        "manual",
        "auto_localization",
        "auto_play",
        "auto_paused",
        "estop",
        "pause_button",
      ]),
    );
    expect(seen.indexOf("unknown")).toBe(0);
    expect(seen.lastIndexOf("unknown")).toBe(0);
  });

  it("never falls back to unknown once the first payload has arrived", () => {
    let inputs: RobotModeInputs = {};
    let seenPayload = false;
    const unknownAfterPayload: number[] = [];

    for (const entry of transitions) {
      inputs = applyMessage(inputs, entry);
      seenPayload ||= inputs.mode != undefined;
      if (seenPayload && deriveRobotMode(inputs).id === "unknown") {
        unknownAfterPayload.push(entry.t);
      }
    }

    expect(seenPayload).toBe(true);
    expect(unknownAfterPayload).toEqual([]);
  });

  it("shows auto localization for the window the localization run was in progress", () => {
    let inputs: RobotModeInputs = {};
    const autolocWindow: number[] = [];
    for (const entry of transitions) {
      inputs = applyMessage(inputs, entry);
      if (deriveRobotMode(inputs).id === "auto_localization") {
        autolocWindow.push(entry.t);
      }
    }
    expect(autolocWindow.length).toBeGreaterThan(0);
    // The run starts when the operator selects AUTO_LOC and ends when the status reports SUCCESS.
    expect(Math.min(...autolocWindow)).toBeGreaterThanOrEqual(312);
    expect(Math.max(...autolocWindow)).toBeLessThanOrEqual(329);
  });

  it("keeps e-stop above the pause button and both above the software mode", () => {
    let inputs: RobotModeInputs = {};
    const whileEstop = new Set<string>();
    const whilePauseButton = new Set<string>();

    for (const entry of transitions) {
      inputs = applyMessage(inputs, entry);
      const id = deriveRobotMode(inputs).id;
      if (inputs.estop === 1) {
        whileEstop.add(id);
      } else if (inputs.pauseButton === 1) {
        whilePauseButton.add(id);
      }
    }

    // The operator pressed both during the run, and each masked whatever software mode was active
    // at the time (the recording was in auto-play for both).
    expect([...whileEstop]).toEqual(["estop"]);
    expect([...whilePauseButton]).toEqual(["pause_button"]);
  });
});
