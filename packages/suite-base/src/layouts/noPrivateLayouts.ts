// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { BundledLayout } from "./index";

/**
 * Fallback for the `@lichtblick/private-layouts` alias when `src/layouts/private/` is not present
 * (i.e. any build without the proprietary layouts submodule). Keeps the build self-contained.
 */
export const privateLayouts: BundledLayout[] = [];

/**
 * Empty error-code catalog for builds without the proprietary submodule. The Robot Errors panel
 * degrades to listing bare codes marked "unrecognised" — the same path it takes for a code newer
 * than the bundled catalog — so the panel stays useful without Peppermint's text.
 */
export const privateErrorCatalog: Record<
  string,
  { title: string; description: string; severity: "error" | "warning" }
> = {};

/**
 * No recorded `error_codes_list` capture without the proprietary submodule. The Robot Errors replay
 * test skips itself when this is empty, so the suite passes on an open-source checkout — and this
 * is also what jest sees, since its moduleNameMapper always points at this stub.
 */
export const privateErrorCodeFixture: { t: number; data: string }[] = [];

/**
 * No recorded Robot Mode capture without the proprietary submodule. The panel's replay test skips
 * itself when this is empty, which is also what jest always sees.
 */
export const privateRobotModeFixture: {
  t: number;
  topic: string;
  value: Record<string, unknown>;
}[] = [];
