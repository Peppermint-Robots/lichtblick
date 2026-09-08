// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// The catalog *shape* lives here; the catalog *contents* do not. The operator-facing error text is
// Peppermint's, lifted verbatim from the robot GUI's assets, so it ships in the private-layouts
// submodule (`src/layouts/private/errors/`) and reaches this panel through the
// `@lichtblick/private-layouts` alias. An open-source checkout resolves to the empty stub and the
// panel still works — it lists bare codes and marks them unrecognised, exactly as it does for a
// code newer than the build.
import { privateErrorCatalog } from "@lichtblick/private-layouts";

export type ErrorSeverity = "error" | "warning";

export type ErrorCatalogEntry = {
  /** Short title, as shown on the robot's GUI. */
  title: string;
  /** Operator-facing remediation steps, as shown on the robot's GUI. */
  description: string;
  /** Severity from error_codes.yaml; the runtime topic also carries this, and wins when present. */
  severity: ErrorSeverity;
};

export const ERROR_CATALOG: Record<string, ErrorCatalogEntry> = privateErrorCatalog;
