// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RobotErrorsConfig } from "./types";

/**
 * The topic is stored unnamespaced; RobotNamespaceLayoutAdapter rewrites it to the connected
 * robot's namespace, so the default works on any robot.
 */
export const DEFAULT_CONFIG: RobotErrorsConfig = {
  topic: "/error_codes_list",
  severity: "error",
  showDescriptions: true,
  showAge: true,
};
