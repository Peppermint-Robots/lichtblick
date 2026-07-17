// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Resolved by the `@lichtblick/private-layouts` webpack alias: `src/layouts/private/` when that
// directory exists, otherwise `./noPrivateLayouts`. Lets proprietary layouts ship in Peppermint
// builds without living in this repository.
import { privateLayouts } from "@lichtblick/private-layouts";
import { LayoutData } from "@lichtblick/suite-base";

import robotDiagnosticsLayout from "./robotDiagnostics.json";

export type BundledLayout = {
  name: string;
  /** Bump when the layout content changes so existing installations pick up the new version. */
  version: number | string;
  data: LayoutData;
};

/**
 * Default layouts compiled into the web build. Topic names are generic (`/odom`, `/scan`, ...)
 * and resolve against robot-namespaced sources via the built-in robot-namespace topic aliases.
 */
export const bundledLayouts: BundledLayout[] = [
  {
    name: "Robot Diagnostics",
    version: 3,
    data: robotDiagnosticsLayout as LayoutData,
  },
  ...privateLayouts,
];
