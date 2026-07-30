// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RobotModeConfig } from "./types";

/**
 * Topics are written unnamespaced. `RobotNamespaceLayoutAdapter` rewrites them to the connected
 * robot's namespace at runtime (`/op_speed_from_gui` -> `/SD0452000/op_speed_from_gui`), so the
 * defaults work on any robot without editing the panel.
 */
export const DEFAULT_CONFIG: RobotModeConfig = {
  opSpeedTopic: "/op_speed_from_gui",
  autoModeStatusTopic: "/auto_mode_status",
  modbusTopic: "/modbus_to_gui",
  localizationStatusTopic: "/initial_localization_status",
  velocitySourceTopic: "/current_velocity_source",
  style: "background",
  showDetails: true,
};
