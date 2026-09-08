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

import { CatalogOverrideResult } from "./catalogOverride";
import { RobotErrorsConfig } from "./types";

export function settingsActionReducer(
  prevConfig: RobotErrorsConfig,
  action: SettingsTreeAction,
): RobotErrorsConfig {
  return produce(prevConfig, (draft) => {
    if (action.action === "update") {
      const key = action.payload.path[1];
      if (key != undefined) {
        _.set(draft, [key], action.payload.value);
      }
    }
  });
}

export function useSettingsTree(
  config: RobotErrorsConfig,
  catalog: CatalogOverrideResult,
): SettingsTreeNodes {
  const { topic, severity, showDescriptions, showAge, catalogOverride } = config;

  const generalSettings: SettingsTreeNode = useMemo(
    () => ({
      label: "General",
      fields: {
        topic: {
          label: "Topic",
          input: "string",
          value: topic,
          help: "std_msgs/String carrying {\"error\": [...], \"warnings\": [...]}",
        },
        severity: {
          label: "Show",
          input: "select",
          value: severity,
          options: [
            { label: "Errors", value: "error" },
            { label: "Warnings", value: "warning" },
          ],
          help: "Which list from the payload this panel displays",
        },
        showDescriptions: {
          label: "Show guidance",
          input: "boolean",
          value: showDescriptions,
          help: "Show the operator remediation steps under each entry",
        },
        showAge: {
          label: "Show age",
          input: "boolean",
          value: showAge,
          help: "How long each entry has been continuously active",
        },
      },
    }),
    [topic, severity, showDescriptions, showAge],
  );

  const catalogSettings: SettingsTreeNode = useMemo(
    () => ({
      label: "Code catalog",
      error: catalog.error,
      fields: {
        catalogOverride: {
          label: "Override",
          input: "string",
          value: catalogOverride ?? "",
          help:
            catalog.overrideCount != undefined
              ? `Using ${catalog.overrideCount} overridden code(s); unlisted codes fall back to the bundled catalog.`
              : "Paste the robot's robot_errors.json (or {code:{title,description}}) to describe codes newer than this build. Unknown codes are always listed regardless.",
        },
      },
    }),
    [catalogOverride, catalog.error, catalog.overrideCount],
  );

  return useShallowMemo({
    general: generalSettings,
    catalog: catalogSettings,
  });
}
