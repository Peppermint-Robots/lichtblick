// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import JSZip from "jszip";

import { ALLOWED_FILES } from "@lichtblick/suite-base/services/extension/types";
import extractFoxeFileContent from "@lichtblick/suite-base/services/extension/utils/extractFoxeFileContent";
import validatePackageInfo from "@lichtblick/suite-base/services/extension/utils/validatePackageInfo";
import { Namespace } from "@lichtblick/suite-base/types";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

/**
 * Reads an extension's metadata from its decompressed `.foxe`: the validated `package.json`, plus
 * the derived `id` and `qualifiedName` and the optional README/CHANGELOG. Shared by loaders that
 * parse `.foxe` files in the browser so they all derive identical ids.
 */
export default async function extractExtensionInfo(
  zip: JSZip,
  namespace: Namespace,
): Promise<ExtensionInfo> {
  const rawPackageFile = await extractFoxeFileContent(zip, ALLOWED_FILES.PACKAGE);
  if (!rawPackageFile) {
    throw new Error(
      `Corrupted extension. File "${ALLOWED_FILES.PACKAGE}" is missing in the extension source.`,
    );
  }
  const readme = (await extractFoxeFileContent(zip, ALLOWED_FILES.README)) ?? "";
  const changelog = (await extractFoxeFileContent(zip, ALLOWED_FILES.CHANGELOG)) ?? "";

  const rawInfo = validatePackageInfo(JSON.parse(rawPackageFile) as Partial<ExtensionInfo>);
  const normalizedPublisher = rawInfo.publisher.replace(/[^A-Za-z0-9_\s]+/g, "");

  return {
    ...rawInfo,
    id: `${normalizedPublisher}.${rawInfo.name}`,
    namespace,
    qualifiedName: rawInfo.displayName || rawInfo.name,
    readme,
    changelog,
  };
}
