// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Logger from "@lichtblick/log";
import { LayoutData, LayoutInfo, LayoutLoader } from "@lichtblick/suite-base";

import { BundledLayout } from "../layouts";

const log = Logger.getLogger(__filename);

/** Well-known path (relative to the served web bundle) the host app can place a manifest at. */
const DEFAULT_MANIFEST_PATH = "layouts/index.json";

export type WebLayoutManifest = {
  layouts: Array<{ name: string; version: number | string; data: LayoutData }>;
};

/**
 * Provides default layouts for the web build from two sources:
 *
 * 1. Layouts bundled into the build (see `packages/suite-web/src/layouts/`).
 * 2. A JSON manifest served by the host application, fetched from the `layoutsUrl` URL parameter
 *    or, when absent, from the well-known relative path `layouts/index.json`. Host-served layouts
 *    override bundled layouts with the same name.
 *
 * Each layout is identified as `web:<name>@<version>`; bumping a layout's version replaces the
 * stored copy on next launch (see loadDefaultLayouts).
 */
export class WebLayoutLoader implements LayoutLoader {
  public readonly namespace = "local";
  #bundled: readonly BundledLayout[];
  #manifestUrl: string;

  public constructor(bundled: readonly BundledLayout[], manifestUrl?: string) {
    this.#bundled = bundled;
    this.#manifestUrl = manifestUrl ?? DEFAULT_MANIFEST_PATH;
  }

  public fetchLayouts = async (): Promise<LayoutInfo[]> => {
    const layoutsByName = new Map<string, BundledLayout>();
    for (const layout of this.#bundled) {
      layoutsByName.set(layout.name, layout);
    }

    for (const layout of await this.#fetchManifestLayouts()) {
      layoutsByName.set(layout.name, layout);
    }

    const layouts = [...layoutsByName.values()].map(({ name, version, data }) => ({
      name,
      from: `web:${name}@${version}`,
      data,
    }));
    log.debug(`Loaded ${layouts.length} web default layout(s)`);
    return layouts;
  };

  async #fetchManifestLayouts(): Promise<BundledLayout[]> {
    try {
      const response = await fetch(this.#manifestUrl);
      if (!response.ok) {
        // A host app that ships no layout manifest is a normal configuration.
        log.debug(`No layout manifest at ${this.#manifestUrl} (HTTP ${response.status})`);
        return [];
      }
      const manifest = (await response.json()) as { layouts?: unknown };
      if (!Array.isArray(manifest.layouts)) {
        log.warn(`Layout manifest at ${this.#manifestUrl} has no "layouts" array`);
        return [];
      }
      return (manifest.layouts as Partial<BundledLayout>[]).filter(
        (layout): layout is BundledLayout =>
          typeof layout.name === "string" &&
          layout.name.length > 0 &&
          (typeof layout.version === "number" || typeof layout.version === "string") &&
          layout.data != undefined,
      );
    } catch (err: unknown) {
      log.debug(`Failed to fetch layout manifest from ${this.#manifestUrl}: ${err}`);
      return [];
    }
  }
}
