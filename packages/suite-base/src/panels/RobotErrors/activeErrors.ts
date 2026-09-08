// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ErrorCatalogEntry, ErrorSeverity } from "./errorCatalog";
import { ActiveError } from "./types";

/** Catalog lookup, so the panel can be handed an override catalog in place of the bundled one. */
export type CatalogLookup = (code: string) => ErrorCatalogEntry | undefined;

/**
 * When each code was first seen, in **playback seconds** (the data source's own clock), not
 * wall-clock.
 *
 * The topic carries no timestamps of its own, so the age has to be synthesised — but it must be
 * synthesised from the playhead rather than from `Date.now()`. Wall-clock ages keep counting while
 * playback is paused, ignore playback speed, and go nonsensical when the user scrubs backward.
 * Measuring against `currentTime` makes the age a property of the recording: it freezes on pause,
 * runs at whatever rate playback runs, and is identical every time the same bag is replayed.
 * The list is republished at 10 Hz, so "first seen" is accurate to ~100 ms of bag time.
 */
export type FirstSeenMap = Map<string, number>;

/**
 * Update the first-seen bookkeeping against the current snapshot.
 *
 * Codes present in `codes` keep their existing timestamp; new codes get `now`; codes no longer
 * present are dropped, so a code that clears and returns is correctly timed from its reappearance.
 * Mutates and returns `firstSeen` — the caller owns a single map for the panel's lifetime.
 *
 * `now` is a playback timestamp in seconds. A code whose stored time is in the *future* relative to
 * `now` is re-stamped: that means the user scrubbed backwards past the point where the code first
 * appeared, and keeping the old value would render a negative age.
 */
export function updateFirstSeen(
  firstSeen: FirstSeenMap,
  codes: readonly string[],
  now: number,
): FirstSeenMap {
  const current = new Set(codes);
  for (const code of firstSeen.keys()) {
    if (!current.has(code)) {
      firstSeen.delete(code);
    }
  }
  for (const code of codes) {
    const seen = firstSeen.get(code);
    if (seen == undefined || seen > now) {
      firstSeen.set(code, now);
    }
  }
  return firstSeen;
}

/**
 * Resolve raw codes into displayable entries.
 *
 * Unknown codes are kept rather than dropped: the robot injects "external errors" straight onto the
 * list without going through the code catalog at all, and the bundled catalog is a snapshot that
 * drifts as the robot software changes. A code with no catalog entry is shown as itself and
 * flagged, so a field engineer on a newer robot still sees that something is wrong.
 */
export function resolveErrors(
  codes: readonly string[],
  severity: ErrorSeverity,
  firstSeen: FirstSeenMap,
  lookup: CatalogLookup,
  now: number,
): ActiveError[] {
  return codes.map((code) => {
    const entry = lookup(code);
    return {
      code,
      // The array the code arrived in is authoritative for severity: classification is a policy
      // choice on the robot (the catalog even notes codes that could be either), so a catalog
      // entry must not override where the publisher actually put it.
      severity,
      title: entry?.title ?? code,
      description: entry?.description ?? "",
      unknown: entry == undefined,
      firstSeen: firstSeen.get(code) ?? now,
    };
  });
}

/**
 * Compact age for display, e.g. "3s", "2m 04s", "1h 12m".
 *
 * Takes **playback seconds**, matching what `FirstSeenMap` stores.
 */
export function formatAge(elapsedSeconds: number): string {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return "";
  }
  const totalSeconds = Math.floor(elapsedSeconds);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
