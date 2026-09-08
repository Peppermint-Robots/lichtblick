// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ERROR_CATALOG, ErrorCatalogEntry } from "./errorCatalog";

export type CatalogOverrideResult = {
  /** Lookup that consults the override first, then the bundled catalog. */
  lookup: (code: string) => ErrorCatalogEntry | undefined;
  /** How many codes the override supplied; undefined when no override is configured. */
  overrideCount?: number;
  /** Parse failure to surface in the settings sidebar. */
  error?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Build a catalog lookup from an optional user-supplied JSON blob.
 *
 * The bundled catalog is generated from the robot's GUI assets at build time, so it drifts as codes
 * are added. Rather than force a rebuild, a field engineer can paste a newer catalog into the panel
 * settings. Two shapes are accepted:
 *
 *  - the robot's own `robot_errors.json`: `{"E001": {"error": "...", "errorDesc": "..."}}`
 *    (the values are i18n keys on the robot; whatever text they hold here is shown as-is)
 *  - a simple `{"E001": {"title": "...", "description": "..."}}`
 *
 * Unknown codes remain visible either way — the override supplements the bundled catalog rather
 * than replacing it, so a partial override does not hide anything.
 */
export function buildCatalogLookup(overrideJson: string | undefined): CatalogOverrideResult {
  const trimmed = overrideJson?.trim();
  if (trimmed == undefined || trimmed.length === 0) {
    return { lookup: (code) => ERROR_CATALOG[code] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      lookup: (code) => ERROR_CATALOG[code],
      error: `Could not parse catalog: ${(err as Error).message}`,
    };
  }

  if (typeof parsed !== "object" || parsed == undefined || Array.isArray(parsed)) {
    return {
      lookup: (code) => ERROR_CATALOG[code],
      error: "Catalog must be a JSON object keyed by error code",
    };
  }

  const override: Record<string, ErrorCatalogEntry> = {};
  for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "object" || value == undefined) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    const title = asString(entry.title) ?? asString(entry.error);
    const description = asString(entry.description) ?? asString(entry.errorDesc) ?? "";
    if (title == undefined) {
      continue;
    }
    override[code] = {
      title,
      description,
      // Severity always comes from the array the code arrived in, so any value here is unused;
      // keep the field well-formed for type compatibility.
      severity: "error",
    };
  }

  const overrideCount = Object.keys(override).length;
  if (overrideCount === 0) {
    return {
      lookup: (code) => ERROR_CATALOG[code],
      error: "No usable entries found (expected {code: {title|error, description|errorDesc}})",
    };
  }

  return {
    lookup: (code) => override[code] ?? ERROR_CATALOG[code],
    overrideCount,
  };
}
