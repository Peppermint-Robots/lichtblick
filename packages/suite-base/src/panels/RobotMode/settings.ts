// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";
import { useMemo } from "react";

import { useShallowMemo } from "@lichtblick/hooks";
import { SettingsTreeAction, SettingsTreeNode, SettingsTreeNodes } from "@lichtblick/suite";

import { RobotModeConfig } from "./types";

export function settingsActionReducer(
  prevConfig: RobotModeConfig,
  action: SettingsTreeAction,
): RobotModeConfig {
  return produce(prevConfig, (draft) => {
    if (action.action === "update") {
      // Every field is a flat key on the config, under either the "general" or "topics" group.
      const key = action.payload.path[1];
      if (key != undefined) {
        _.set(draft, [key], action.payload.value);
      }
    }
  });
}

export function useSettingsTree(config: RobotModeConfig): SettingsTreeNodes {
  const {
    opSpeedTopic,
    autoModeStatusTopic,
    modbusTopic,
    localizationStatusTopic,
    velocitySourceTopic,
    style,
    showDetails,
  } = config;

  const generalSettings: SettingsTreeNode = useMemo(
    () => ({
      label: "General",
      fields: {
        style: {
          label: "Style",
          input: "select",
          value: style,
          options: [
            { label: "Background", value: "background" },
            { label: "Bulb", value: "bulb" },
          ],
        },
        showDetails: {
          label: "Show details",
          input: "boolean",
          value: showDetails,
          help: "Show the raw values the mode was derived from",
        },
      },
    }),
    [style, showDetails],
  );

  const topicSettings: SettingsTreeNode = useMemo(
    () => ({
      label: "Topics",
      // Topic names are stored unnamespaced; the robot-namespace adapter rewrites them to the
      // connected robot at runtime, so these rarely need editing.
      fields: {
        opSpeedTopic: {
          label: "Op speed",
          input: "string",
          value: opSpeedTopic,
          help: "std_msgs/String — drive mode and auto play/pause",
        },
        autoModeStatusTopic: {
          label: "Auto mode status",
          input: "string",
          value: autoModeStatusTopic,
          help: "std_msgs/Float32 — auto started flag",
        },
        modbusTopic: {
          label: "Modbus to GUI",
          input: "string",
          value: modbusTopic,
          help: "std_msgs/UInt8MultiArray — [6] e-stop, [10] pause button",
        },
        localizationStatusTopic: {
          label: "Localization status",
          input: "string",
          value: localizationStatusTopic,
          help: "GenericStatus — state 1 while auto-localization runs",
        },
        velocitySourceTopic: {
          label: "Velocity source",
          input: "string",
          value: velocitySourceTopic,
          help: "std_msgs/String — active cmd_vel mux input",
        },
      },
    }),
    [
      opSpeedTopic,
      autoModeStatusTopic,
      modbusTopic,
      localizationStatusTopic,
      velocitySourceTopic,
    ],
  );

  return useShallowMemo({
    general: generalSettings,
    topics: topicSettings,
  });
}
