// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PanelExtensionContext } from "@lichtblick/suite";

import { ErrorSeverity } from "./errorCatalog";

/** One active error/warning, resolved against the catalog for display. */
export type ActiveError = {
  /** Raw code off the wire, e.g. "E001". */
  code: string;
  severity: ErrorSeverity;
  /** Catalog title, or a placeholder when the code is unknown to this build. */
  title: string;
  /** Catalog remediation text; empty when the code is unknown. */
  description: string;
  /** True when the code was not found in the catalog. */
  unknown: boolean;
  /**
   * Playback time (seconds, from the data source's clock) when this code was first seen in a
   * continuous run of messages. Errors persist, so this is what lets the panel show how long one has
   * been standing — measured in bag time, so it freezes on pause and follows playback speed.
   */
  firstSeen: number;
};

export type RobotErrorsConfig = {
  /** Topic carrying `error_codes_list` (std_msgs/String containing JSON). */
  topic: string;
  /**
   * Which of the payload's two arrays this panel instance renders. One panel type serves both, so
   * a layout can place an errors panel and a warnings panel side by side.
   */
  severity: ErrorSeverity;
  /** Show the operator remediation text under each title. */
  showDescriptions: boolean;
  /** Show how long each error has been active. */
  showAge: boolean;
  /**
   * Optional replacement catalog, pasted in by an engineer whose robot is newer than this build.
   * Accepts the robot's own `robot_errors.json` shape (code -> {error, errorDesc}) with i18n keys
   * already resolved, or the simpler {code: {title, description}} shape. Empty = use the bundled
   * catalog.
   */
  catalogOverride?: string;
};

export type RobotErrorsProps = {
  context: PanelExtensionContext;
};
