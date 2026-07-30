// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PanelExtensionContext } from "@lichtblick/suite";

/**
 * Identifier for a derived robot mode. Ordered here roughly by descending severity; the actual
 * precedence lives in `MODE_PRECEDENCE` (deriveRobotMode.ts).
 */
export type RobotModeId =
  | "estop"
  | "pause_button"
  | "auto_localization"
  | "teleop"
  | "auto_paused"
  | "auto_play"
  | "manual"
  | "unknown";

export type RobotModeDescriptor = {
  id: RobotModeId;
  /** Text shown in the panel. */
  label: string;
  /** Background/bulb color. */
  color: string;
};

/** Raw values scraped from the subscribed topics, before any precedence is applied. */
export type RobotModeInputs = {
  /** `op_speed_from_gui[0]` — 0 MANUAL, 1 AUTO, 2 TELEOP, 3 AUTO_LOC. */
  mode?: number;
  /** `op_speed_from_gui[3]` — 1 play, 0 pause. Only meaningful when mode is AUTO. */
  autoStarted?: number;
  /** `auto_mode_status.data` — state_manager's already mode-gated play flag. */
  autoModeStatus?: number;
  /** `modbus_to_gui.data[6]` — non-zero when the e-stop is pressed. */
  estop?: number;
  /** `modbus_to_gui.data[10]` — non-zero when the stop-and-hold (pause) button is pressed. */
  pauseButton?: number;
  /** `initial_localization_status.state` — 1 (INPROGRESS) while auto-localization runs. */
  localizationState?: number;
  /** `current_velocity_source.data` — the actually-selected cmd_vel mux input. */
  velocitySource?: string;
};

export type RobotModeConfig = {
  /** Topic carrying `op_speed_from_gui` (std_msgs/String). */
  opSpeedTopic: string;
  /** Topic carrying `auto_mode_status` (std_msgs/Float32). */
  autoModeStatusTopic: string;
  /** Topic carrying `modbus_to_gui` (std_msgs/UInt8MultiArray). */
  modbusTopic: string;
  /** Topic carrying `initial_localization_status` (robot_msgs_r2/GenericStatus). */
  localizationStatusTopic: string;
  /** Topic carrying `current_velocity_source` (std_msgs/String). */
  velocitySourceTopic: string;
  /** Render as a colored bulb with a label, or a filled background. */
  style: "bulb" | "background";
  /** Show the contributing raw values underneath the mode label. */
  showDetails: boolean;
};

export type RobotModeProps = {
  context: PanelExtensionContext;
};
