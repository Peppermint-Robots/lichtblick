// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ErrorSeverity } from "./errorCatalog";

/**
 * `error_codes_list` is a `std_msgs/String` whose `data` is a JSON document:
 *
 *     {"error": ["E001", "E002"], "warnings": ["W001", "W002"]}
 *
 * Note the asymmetric key names — `error` is singular, `warnings` is plural
 * (`error_code_manager.cpp`: `error_code_list["error"] = errors_list;`).
 *
 * The publisher rebuilds both lists from scratch every 100 ms, so each message is a **complete
 * snapshot** of what is active right now: an empty array genuinely means "nothing wrong", and a
 * code that disappears has cleared. Consumers must replace their state wholesale rather than
 * accumulate.
 */
export type ParsedErrorCodes = {
  error: string[];
  warnings: string[];
};

function toCodeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    // The publisher pushes with no uniqueness check, and a few conditions push the same code from
    // two independent branches (e.g. E003), so duplicates do reach the wire. Order is preserved
    // because it encodes the intended priority.
    if (typeof entry !== "string") {
      continue;
    }
    const code = entry.trim();
    if (code.length === 0 || seen.has(code)) {
      continue;
    }
    seen.add(code);
    out.push(code);
  }
  return out;
}

/**
 * Parse an `error_codes_list` payload. Returns `undefined` when the payload is not the expected
 * JSON object, so a malformed publish leaves the previous state on screen instead of blanking the
 * panel — with a 10 Hz republish rate a transient bad message would otherwise flicker.
 */
export function parseErrorCodes(payload: string | undefined): ParsedErrorCodes | undefined {
  if (payload == undefined || payload.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed == undefined || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  // Absent keys are normal rather than an error: treat them as empty.
  return {
    error: toCodeList(record.error),
    warnings: toCodeList(record.warnings),
  };
}

/** Select the list a panel instance renders. */
export function codesForSeverity(
  parsed: ParsedErrorCodes | undefined,
  severity: ErrorSeverity,
): string[] {
  if (parsed == undefined) {
    return [];
  }
  return severity === "warning" ? parsed.warnings : parsed.error;
}
