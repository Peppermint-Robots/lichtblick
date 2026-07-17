// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Resolved by the `@lichtblick/private-layouts` alias (defined in suite-base's webpack makeConfig
// and mirrored in the tsconfigs): `src/layouts/private/` when that submodule is present, otherwise
// `./noPrivateLayouts`. Lets proprietary layouts ship in Peppermint builds without living in this
// repository.
import { privateLayouts } from "@lichtblick/private-layouts";
import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext";

import robotDiagnosticsLayout from "./robotDiagnostics.json";

export type BundledLayout = {
  name: string;
  /** Bump when the layout content changes so existing installations pick up the new version. */
  version: number | string;
  data: LayoutData;
};

/**
 * Default layouts compiled into the web and desktop builds. Topic references are adapted to the
 * connected robot's namespace at runtime by RobotNamespaceLayoutAdapter, so layouts work for any
 * robot regardless of the namespace they were authored against.
 */
export const bundledLayouts: BundledLayout[] = [
  {
    name: "Robot Diagnostics",
    version: 3,
    data: robotDiagnosticsLayout as LayoutData,
  },
  ...privateLayouts,
];
