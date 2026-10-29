// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Resolved by the `@lichtblick/private-layouts` alias, like the bundled layouts (see
// ../layouts/index.ts): extensions from the private submodule when it is present, otherwise none.
import { privateExtensions } from "@lichtblick/private-layouts";

/**
 * URLs of the `.foxe` extensions compiled into the web and desktop builds, served read-only by
 * BundledExtensionLoader.
 */
export const bundledExtensions: readonly string[] = [...privateExtensions];
