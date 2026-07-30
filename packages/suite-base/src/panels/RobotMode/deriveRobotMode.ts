// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RobotModeDescriptor, RobotModeId, RobotModeInputs } from "./types";

/**
 * Peppermint drive modes, as carried in field 0 of `op_speed_from_gui`.
 *
 * Mirrors `enum class Mode` in
 * `state_manager_ppmt/include/state_manager_ppmt/comm/state_machine_context.hpp`.
 */
export const OP_SPEED_MODE = {
  MANUAL: 0,
  AUTO: 1,
  TELEOP: 2,
  AUTO_LOC: 3,
} as const;

/** Index of the e-stop byte in `modbus_to_gui.data` (`modbus_node.cpp`: `to_gui_[6]`). */
export const MODBUS_ESTOP_INDEX = 6;
/** Index of the stop-and-hold / pause button byte in `modbus_to_gui.data` (`to_gui_[10]`). */
export const MODBUS_PAUSE_BUTTON_INDEX = 10;

/** `robot_msgs_r2/GenericStatus.state` value meaning auto-localization is running. */
export const LOCALIZATION_INPROGRESS = 1;

export const MODE_DESCRIPTORS: Record<RobotModeId, RobotModeDescriptor> = {
  estop: { id: "estop", label: "E-STOP PRESSED", color: "#e62b4d" },
  pause_button: { id: "pause_button", label: "PAUSE BUTTON", color: "#fb8c00" },
  auto_localization: { id: "auto_localization", label: "AUTO LOCALIZATION", color: "#7c4dff" },
  teleop: { id: "teleop", label: "TELEOP", color: "#00b8d4" },
  auto_paused: { id: "auto_paused", label: "AUTO PAUSED", color: "#e0ca1d" },
  auto_play: { id: "auto_play", label: "AUTO MODE", color: "#68e24a" },
  manual: { id: "manual", label: "MANUAL MODE", color: "#4a90e2" },
  unknown: { id: "unknown", label: "UNKNOWN", color: "#a0a0a0" },
};

/**
 * Parse the `op_speed_from_gui` payload: a stringified 4-element float array
 * `"[mode, manual_speed, auto_speed, auto_started]"`.
 *
 * Two encodings are on the wire and both must be accepted: the C++ `std::to_string` form emitted by
 * state_manager / localization_manager (`"[1.000000,0.400000,0.500000,1.000000]"`) and the strict
 * JSON form emitted by the mobile MQTT client and the FMS client (`"[1.0, 0.4, 0.5, 1.0]"`).
 * Mirrors `OpSpeedData::updateFromGUIString` and `LocalizationManager::parseOpSpeedPayload`, but is
 * tolerant like the latter: a malformed payload yields `undefined` rather than throwing.
 */
export function parseOpSpeed(payload: string | undefined): number[] | undefined {
  if (payload == undefined) {
    return undefined;
  }
  let data = payload.trim();
  if (data.length === 0) {
    return undefined;
  }
  if (data.startsWith("[")) {
    data = data.slice(1);
  }
  if (data.endsWith("]")) {
    data = data.slice(0, -1);
  }

  const values: number[] = [];
  for (const token of data.split(",")) {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      return undefined;
    }
    values.push(value);
  }

  // Every consumer in the robot stack requires all four fields before trusting the payload.
  return values.length >= 4 ? values : undefined;
}

/** Float comparison against a mode constant, tolerant of the parse jitter the C++ side allows. */
function isMode(value: number | undefined, mode: number): boolean {
  return value != undefined && Math.abs(value - mode) < 0.5;
}

/**
 * Collapse the raw topic values into a single mode.
 *
 * Precedence is deliberate and safety-first: a pressed e-stop is what the operator most needs to
 * see, so it wins over every software mode; the pause button comes next. Only then do the software
 * modes apply, taken from `op_speed_from_gui[0]`.
 *
 * `auto_started` is force-zeroed by state_manager for MANUAL/TELEOP/AUTO_LOC, so the play/pause
 * split is only meaningful under AUTO. `auto_mode_status` is state_manager's own already-gated copy
 * of that flag and is used as the fallback when no `op_speed_from_gui` payload has arrived — that
 * topic is published on change only, so a late-joining subscriber can otherwise sit blank.
 */
export function deriveRobotMode(inputs: RobotModeInputs): RobotModeDescriptor {
  const { mode, autoStarted, autoModeStatus, estop, pauseButton, localizationState, velocitySource } =
    inputs;

  if (estop != undefined && estop !== 0) {
    return MODE_DESCRIPTORS.estop;
  }
  if (pauseButton != undefined && pauseButton !== 0) {
    return MODE_DESCRIPTORS.pause_button;
  }

  // Auto-localization: either declared via the mode field, or observed in progress on the status
  // topic (the run is driven by localization_manager, which may briefly precede the mode change).
  if (isMode(mode, OP_SPEED_MODE.AUTO_LOC) || localizationState === LOCALIZATION_INPROGRESS) {
    return MODE_DESCRIPTORS.auto_localization;
  }

  if (isMode(mode, OP_SPEED_MODE.TELEOP) || velocitySource === "teleop_cmd_vel") {
    return MODE_DESCRIPTORS.teleop;
  }

  if (isMode(mode, OP_SPEED_MODE.AUTO)) {
    const playing = autoStarted != undefined ? autoStarted > 0 : (autoModeStatus ?? 0) > 0;
    return playing ? MODE_DESCRIPTORS.auto_play : MODE_DESCRIPTORS.auto_paused;
  }

  if (isMode(mode, OP_SPEED_MODE.MANUAL)) {
    return MODE_DESCRIPTORS.manual;
  }

  // No op_speed payload seen yet. auto_mode_status is published at 2 Hz and latched, so it is
  // usually the first thing to arrive; it can only ever indicate auto-play.
  if (autoModeStatus != undefined) {
    return autoModeStatus > 0 ? MODE_DESCRIPTORS.auto_play : MODE_DESCRIPTORS.unknown;
  }

  return MODE_DESCRIPTORS.unknown;
}
