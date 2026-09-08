// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toSec } from "@lichtblick/rostime";
import { MessageEvent, SettingsTreeAction } from "@lichtblick/suite";
import Stack from "@lichtblick/suite-base/components/Stack";

import { useStyles } from "./RobotErrors.style";
import { formatAge, resolveErrors, updateFirstSeen } from "./activeErrors";
import { buildCatalogLookup } from "./catalogOverride";
import { DEFAULT_CONFIG } from "./constants";
import { codesForSeverity, parseErrorCodes } from "./parseErrorCodes";
import { settingsActionReducer, useSettingsTree } from "./settings";
import { ActiveError, RobotErrorsConfig, RobotErrorsProps } from "./types";

export function RobotErrors({ context }: RobotErrorsProps): React.JSX.Element {
  const [renderDone, setRenderDone] = useState<() => void>(() => () => {});

  const [config, setConfig] = useState<RobotErrorsConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...(context.initialState as Partial<RobotErrorsConfig>),
  }));

  /** Raw payload of the most recent message; the panel state is derived from it. */
  const [payload, setPayload] = useState<string | undefined>(undefined);

  /**
   * Playhead position in seconds. Ages are measured against this rather than wall-clock, so they
   * stop while playback is paused, advance at the playback rate, and stay identical across replays
   * of the same recording. The player emits render states as time advances, so this doubles as the
   * re-render trigger — no wall-clock ticker is needed.
   */
  const [playbackTime, setPlaybackTime] = useState<number | undefined>(undefined);

  // First-seen timestamps survive re-renders but are not render state: mutating them must not
  // itself trigger a render, so they live in a ref and are updated during derivation.
  const firstSeenRef = useRef(new Map<string, number>());

  useEffect(() => {
    context.saveState(config);
  }, [config, context]);

  useEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);

      if (renderState.currentTime != undefined) {
        setPlaybackTime(toSec(renderState.currentTime));
      }

      if (renderState.didSeek === true) {
        setPayload(undefined);
        firstSeenRef.current.clear();
      }

      const frame = renderState.currentFrame;
      if (frame && frame.length > 0) {
        // The list is republished at 10 Hz whether or not anything changed, so only the last
        // message in the frame matters.
        const last = frame[frame.length - 1] as MessageEvent;
        const data = (last.message as { data?: unknown } | undefined)?.data;
        // Only adopt a payload that actually parses. A malformed publish must not replace the last
        // good snapshot, or a single bad message would blank the list — and at 10 Hz the panel
        // would visibly flicker.
        if (typeof data === "string" && parseErrorCodes(data) != undefined) {
          // Skipping identical payloads keeps React from re-rendering 10x/second.
          setPayload((prev) => (prev === data ? prev : data));
        }
      }
    };
    context.watch("currentFrame");
    context.watch("didSeek");
    context.watch("currentTime");

    return () => {
      context.onRender = undefined;
    };
  }, [context]);

  useEffect(() => {
    if (config.topic.length > 0) {
      context.subscribe([{ topic: config.topic, preload: false }]);
    }
    return () => {
      context.unsubscribeAll();
    };
  }, [context, config.topic]);

  const catalog = useMemo(() => buildCatalogLookup(config.catalogOverride), [config.catalogOverride]);

  const settingsActionHandler = useCallback((action: SettingsTreeAction) => {
    setConfig((prevConfig) => settingsActionReducer(prevConfig, action));
  }, []);

  const settingsTree = useSettingsTree(config, catalog);
  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: settingsTree,
    });
  }, [context, settingsActionHandler, settingsTree]);

  useEffect(() => {
    renderDone();
  }, [renderDone]);

  const parsed = useMemo(() => parseErrorCodes(payload), [payload]);
  const codes = useMemo(() => codesForSeverity(parsed, config.severity), [parsed, config.severity]);

  const errors: ActiveError[] = useMemo(() => {
    // Before the first render state carries a time (e.g. a live connection that has not published
    // one yet), everything is stamped 0 and ages simply read "0s" rather than counting wall-clock.
    const now = playbackTime ?? 0;
    updateFirstSeen(firstSeenRef.current, codes, now);
    return resolveErrors(codes, config.severity, firstSeenRef.current, catalog.lookup, now);
  }, [codes, config.severity, catalog, playbackTime]);

  const accent = config.severity === "warning" ? "#f5a623" : "#e62b4d";
  const { classes, cx } = useStyles({ accent });

  const label = config.severity === "warning" ? "Warnings" : "Errors";

  // A payload that has not arrived is genuinely different from an empty list, and conflating them
  // would show "no errors" for a robot we simply are not hearing from.
  if (parsed == undefined) {
    return (
      <Stack fullHeight>
        <Stack className={classes.empty} data-testid="robot-errors-empty">
          <Typography variant="inherit">Waiting for {config.topic}…</Typography>
        </Stack>
      </Stack>
    );
  }

  if (errors.length === 0) {
    return (
      <Stack fullHeight>
        <Stack className={classes.empty} data-testid="robot-errors-empty">
          <Typography variant="inherit">No active {label.toLowerCase()}</Typography>
        </Stack>
      </Stack>
    );
  }

  const now = playbackTime ?? 0;

  return (
    <Stack fullHeight>
      <Stack className={classes.countRow}>
        <Typography className={classes.countLabel} data-testid="robot-errors-count">
          {errors.length} {label}
        </Typography>
      </Stack>
      <Stack className={classes.root} data-testid="robot-errors-list">
        {errors.map((error) => (
          <Stack
            key={error.code}
            className={cx(classes.item, { [classes.itemUnknown]: error.unknown })}
            data-testid={`robot-errors-item-${error.code}`}
          >
            <div className={classes.headerRow}>
              <Typography className={classes.code}>{error.code}</Typography>
              <Typography className={classes.title}>{error.title}</Typography>
              {config.showAge && (
                <Typography className={classes.age} data-testid="robot-errors-age">
                  {formatAge(now - error.firstSeen)}
                </Typography>
              )}
            </div>
            {error.unknown && (
              <Typography className={classes.unknownNote}>
                Not in this build&apos;s catalog — the robot may be newer, or this may be an
                external error
              </Typography>
            )}
            {config.showDescriptions && error.description.length > 0 && (
              <Typography className={classes.description} data-testid="robot-errors-description">
                {error.description}
              </Typography>
            )}
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
