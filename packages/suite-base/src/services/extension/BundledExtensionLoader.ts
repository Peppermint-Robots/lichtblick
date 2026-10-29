// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Log from "@lichtblick/log";
import {
  IExtensionLoader,
  InstallExtensionProps,
  LoadedExtension,
  TypeExtensionLoader,
} from "@lichtblick/suite-base/services/extension/IExtensionLoader";
import { ALLOWED_FILES } from "@lichtblick/suite-base/services/extension/types";
import decompressFile from "@lichtblick/suite-base/services/extension/utils/decompressFile";
import extractExtensionInfo from "@lichtblick/suite-base/services/extension/utils/extractExtensionInfo";
import extractFoxeFileContent from "@lichtblick/suite-base/services/extension/utils/extractFoxeFileContent";
import { Namespace } from "@lichtblick/suite-base/types";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

const log = Log.getLogger(__filename);

/** How long one bundled `.foxe` may take to download before it is skipped. */
export const BUNDLED_EXTENSION_FETCH_TIMEOUT_MS = 15_000;

type BundledEntry = { info: ExtensionInfo; raw: string };

/**
 * Serves extensions compiled into the build (see `packages/suite-base/src/extensions/`), on both
 * the web and the desktop app. Nothing is copied into the user's extension storage, so an
 * extension dropped from the build disappears with it.
 *
 * Read-only: these extensions cannot be installed over or uninstalled. A user-installed copy of
 * the same extension takes precedence unless it is older; ExtensionCatalogProvider decides that.
 */
export class BundledExtensionLoader implements IExtensionLoader {
  public readonly namespace: Namespace = "local";
  public readonly type: TypeExtensionLoader = "bundled";
  readonly #urls: readonly string[];
  #entries?: Promise<Map<string, BundledEntry>>;

  /** @param urls URLs of the bundled `.foxe` files, fetched once on first use. */
  public constructor(urls: readonly string[]) {
    this.#urls = urls;
  }

  public async getExtension(id: string): Promise<ExtensionInfo | undefined> {
    return (await this.#getEntries()).get(id)?.info;
  }

  public async getExtensions(): Promise<ExtensionInfo[]> {
    return [...(await this.#getEntries()).values()].map(({ info }) => info);
  }

  public async loadExtension(id: string): Promise<LoadedExtension> {
    const entry = (await this.#getEntries()).get(id);
    if (!entry) {
      throw new Error(`Bundled extension ${id} not found`);
    }
    return { raw: entry.raw };
  }

  public async installExtension(_data: InstallExtensionProps): Promise<ExtensionInfo> {
    throw new Error("Bundled extensions are read-only");
  }

  public async uninstallExtension(_id: string): Promise<void> {
    throw new Error("Bundled extensions are read-only");
  }

  async #getEntries(): Promise<Map<string, BundledEntry>> {
    this.#entries ??= this.#fetchAll();
    return await this.#entries;
  }

  async #fetchAll(): Promise<Map<string, BundledEntry>> {
    const entries = new Map<string, BundledEntry>();
    const fetched = await Promise.all(this.#urls.map(async (url) => await this.#fetchOne(url)));
    for (const entry of fetched) {
      if (entry != undefined) {
        entries.set(entry.info.id, entry);
      }
    }
    log.debug(`Loaded ${entries.size} bundled extension(s)`);
    return entries;
  }

  /** Fetches and parses one `.foxe`; a broken entry is logged and skipped rather than fatal. */
  async #fetchOne(url: string): Promise<BundledEntry | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, BUNDLED_EXTENSION_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      // Only reject real HTTP errors: file:// responses (desktop) may report status 0. A body that
      // is not a valid extension fails the unzip below.
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`);
      }
      const foxeFileData = new Uint8Array(await response.arrayBuffer());
      const zip = await decompressFile(foxeFileData);
      const raw = await extractFoxeFileContent(zip, ALLOWED_FILES.EXTENSION);
      if (raw == undefined) {
        throw new Error(`missing ${ALLOWED_FILES.EXTENSION}`);
      }
      const info = await extractExtensionInfo(zip, this.namespace);
      return { info: { ...info, size: foxeFileData.length }, raw };
    } catch (err: unknown) {
      log.warn(`Skipping bundled extension ${url}:`, err);
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}
