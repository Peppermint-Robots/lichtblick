// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import React, { PropsWithChildren, useEffect, useState } from "react";
import { StoreApi, createStore } from "zustand";

import Logger from "@lichtblick/log";
import { RegisterMessageConverterArgs } from "@lichtblick/suite";
import {
  ContributionPoints,
  ExtensionCatalog,
  ExtensionCatalogContext,
  ExtensionData,
  InstallExtensionsResult,
  LoadExtensionsResult,
} from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import {
  extensionUniqueKey,
  isOlderVersion,
  isSameExtension,
  LoaderListing,
  loadSingleExtension,
  resolveBundledPrecedence,
  serverLoaderFirst,
  tryInstallSingleLoader,
  removeExtensionData,
  withBundledFlag,
} from "@lichtblick/suite-base/providers/ExtensionCatalogProvider/utils";
import { buildContributionPoints } from "@lichtblick/suite-base/providers/helpers/buildContributionPoints";
import {
  IExtensionLoader,
  TypeExtensionLoader,
} from "@lichtblick/suite-base/services/extension/IExtensionLoader";
import decompressFile from "@lichtblick/suite-base/services/extension/utils/decompressFile";
import extractExtensionInfo from "@lichtblick/suite-base/services/extension/utils/extractExtensionInfo";
import { Namespace } from "@lichtblick/suite-base/types";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

const log = Logger.getLogger(__filename);

function createExtensionRegistryStore(
  loaders: readonly IExtensionLoader[],
  mockMessageConverters: readonly RegisterMessageConverterArgs<unknown>[] | undefined,
): StoreApi<ExtensionCatalog> {
  const orgCacheLoader: IExtensionLoader | undefined = loaders.find(
    (extensionLoader) => extensionLoader.namespace === "org" && extensionLoader.type === "browser",
  );
  const bundledLoaders = loaders.filter((loader) => loader.type === "bundled");

  // A refresh lists the loaders first and publishes last, so its result can be stale by then.
  // Only the latest refresh may publish, and a refresh that sees an install or uninstall land while
  // it ran starts over instead of publishing, so it never undoes that change.
  let refreshGeneration = 0;
  let catalogMutations = 0;

  const listBundled = async (): Promise<ExtensionInfo[]> => {
    try {
      return (
        await Promise.all(bundledLoaders.map(async (loader) => await loader.getExtensions()))
      ).flat();
    } catch (err: unknown) {
      log.error("Error listing bundled extensions", err);
      return [];
    }
  };

  // Whether any of the given extensions is also bundled with the app, in which case installing or
  // uninstalling it can change which copy should be active.
  const anyMatchesBundled = async (extensions: readonly ExtensionInfo[]): Promise<boolean> => {
    if (extensions.length === 0 || bundledLoaders.length === 0) {
      return false;
    }
    const bundled = await listBundled();
    return extensions.some((extension) => bundled.some((b) => isSameExtension(b, extension)));
  };

  // A copy older than the bundled one would never be activated (the bundled copy wins), so
  // installing it would only leave a hidden copy behind. Returns the reason it is refused, if so.
  const refuseOlderThanBundled = async (extension: ExtensionData): Promise<string | undefined> => {
    if (bundledLoaders.length === 0) {
      return undefined;
    }
    let info: ExtensionInfo;
    try {
      info = await extractExtensionInfo(await decompressFile(extension.buffer), "local");
    } catch {
      return undefined; // Not readable here; the loaders report the problem.
    }
    const bundled = (await listBundled()).find((b) => isSameExtension(b, info));
    if (bundled == undefined || !isOlderVersion(info, bundled)) {
      return undefined;
    }
    return `${info.displayName || info.name} ${info.version} is older than the version bundled with the app (${bundled.version}), so it was not installed`;
  };

  return createStore((set, get) => {
    const isExtensionInstalled = (extensionId: string) => {
      return get().loadedExtensions.has(extensionId);
    };

    const markExtensionAsInstalled = (extensionId: string) => {
      const updatedExtensions = new Set(get().loadedExtensions);
      updatedExtensions.add(extensionId);
      set({ loadedExtensions: updatedExtensions });
    };

    const unMarkExtensionAsInstalled = (extensionId: string) => {
      const updatedExtensions = new Set(get().loadedExtensions);
      updatedExtensions.delete(extensionId);
      set({ loadedExtensions: updatedExtensions });
    };

    const downloadExtension = async (url: string) => {
      const res = await fetch(url);
      return new Uint8Array(await res.arrayBuffer());
    };

    const installExtensions = async (namespace: Namespace, extensions: ExtensionData[]) => {
      // Bundled extensions are read-only, so their loader never takes part in an install.
      const namespaceLoaders = loaders.filter(
        (loader) => loader.namespace === namespace && loader.type !== "bundled",
      );
      if (namespaceLoaders.length === 0) {
        throw new Error(`No extension loader found for namespace ${namespace}`);
      }
      const results = await promisesInBatch(extensions, namespaceLoaders);
      const installed = results.flatMap((result) =>
        result.success && result.info != undefined ? [result.info] : [],
      );
      if (await anyMatchesBundled(installed)) {
        // The new copy now competes with a bundled one: rebuild the catalog so the winner's
        // panels and converters are the ones registered.
        await get().refreshAllExtensions();
      }
      return results;
    };

    // Installs a single extension through all matching loaders sequentially.
    // Extracted from the promisesInBatch map callback to keep nesting within 4 levels.
    async function installExtensionWithLoaders(
      extension: ExtensionData,
      extensionLoaders: IExtensionLoader[],
    ): Promise<InstallExtensionsResult> {
      const loaderResults: Array<LoadExtensionsResult> = [];
      let extensionName = extension.file?.name ?? "Unknown extension";

      const refusal = await refuseOlderThanBundled(extension);
      if (refusal != undefined) {
        return { success: false, error: new Error(refusal), extensionName, loaderResults };
      }
      let mergedInfo: ExtensionInfo | undefined;
      let hasAnySuccess = false;
      let externalId: string | undefined;

      // Sort loaders to prioritize server loaders first (to get externalId)
      const sortedLoaders = _.sortBy(extensionLoaders, serverLoaderFirst);

      for (const loader of sortedLoaders) {
        const result = await tryInstallSingleLoader(loader, extension, externalId);

        if (result.success) {
          externalId = result.externalId ?? externalId;
          extensionName = result.info.displayName || result.info.name || extensionName;

          // Only merge state once for the first successful installation
          if (!hasAnySuccess) {
            catalogMutations++;
            get().mergeState(result.info, result.contributionPoints);
            get().markExtensionAsInstalled(result.info.id);
            mergedInfo = result.info;
            hasAnySuccess = true;
          }
        }

        loaderResults.push(
          result.success
            ? { loaderType: result.loaderType, success: true }
            : { loaderType: result.loaderType, success: false, error: result.error },
        );
      }

      if (hasAnySuccess) {
        // At least one loader succeeded
        const failedCount = loaderResults.filter((r) => !r.success).length;
        return {
          success: true,
          info: mergedInfo!,
          extensionName,
          loaderResults,
          error: failedCount > 0 ? new Error("Some loaders failed") : undefined,
        };
      }

      return {
        success: false,
        error: new Error("All loaders failed"),
        extensionName,
        loaderResults,
      };
    }

    async function promisesInBatch(
      batch: ExtensionData[],
      extensionLoaders: IExtensionLoader[],
    ): Promise<InstallExtensionsResult[]> {
      return await Promise.all(
        batch.map(
          async (extension) => await installExtensionWithLoaders(extension, extensionLoaders),
        ),
      );
    }

    const mergeState = (
      info: ExtensionInfo,
      {
        messageConverters,
        panelSettings,
        panels,
        topicAliasFunctions,
        cameraModels,
      }: ContributionPoints,
    ) => {
      set((state) => ({
        installedExtensions: _.uniqBy(
          [info, ...(state.installedExtensions ?? [])],
          extensionUniqueKey,
        ),
        installedPanels: { ...state.installedPanels, ...panels },
        installedMessageConverters: [...state.installedMessageConverters!, ...messageConverters],
        installedTopicAliasFunctions: [
          ...state.installedTopicAliasFunctions!,
          ...topicAliasFunctions,
        ],
        panelSettings: { ...state.panelSettings, ...panelSettings },
        installedCameraModels: new Map([
          ...state.installedCameraModels,
          ...Array.from(cameraModels.entries()),
        ]),
      }));
    };

    // Loads and registers a single extension from one loader into the shared
    // contribution points and installed-extensions list.
    // Extracted from the loadInBatch map callback to keep nesting within 4 levels.
    async function loadAndRegisterExtension(
      extension: ExtensionInfo,
      loader: IExtensionLoader,
      installedExtensions: ExtensionInfo[],
      contributionPoints: ContributionPoints,
    ): Promise<void> {
      try {
        installedExtensions.push(extension);

        const { messageConverters, panelSettings, panels, topicAliasFunctions, cameraModels } =
          contributionPoints;
        const unwrappedExtensionSource = await loadSingleExtension(
          extension,
          loader,
          orgCacheLoader,
        );
        const newContributionPoints = buildContributionPoints(extension, unwrappedExtensionSource);

        _.assign(panels, newContributionPoints.panels);
        _.merge(panelSettings, newContributionPoints.panelSettings);
        messageConverters.push(...newContributionPoints.messageConverters);
        topicAliasFunctions.push(...newContributionPoints.topicAliasFunctions);

        for (const [name, builder] of newContributionPoints.cameraModels) {
          if (cameraModels.has(name)) {
            log.warn(`Camera model "${name}" already registered, skipping.`);
            continue;
          }
          cameraModels.set(name, builder);
        }

        get().markExtensionAsInstalled(extension.id);
      } catch (err) {
        log.error(`Error loading extension ${extension.id}`, err);
      }
    }

    async function loadInBatch({
      batch,
      loader,
      installedExtensions,
      contributionPoints,
    }: {
      batch: ExtensionInfo[];
      loader: IExtensionLoader;
      installedExtensions: ExtensionInfo[];
      contributionPoints: ContributionPoints;
    }) {
      await Promise.all(
        batch.map(async (extension) => {
          await loadAndRegisterExtension(
            extension,
            loader,
            installedExtensions,
            contributionPoints,
          );
        }),
      );
    }

    const refreshAllExtensions = async () => {
      log.debug("Refreshing all extensions");
      if (loaders.length === 0) {
        return;
      }
      const generation = ++refreshGeneration;
      const mutationsAtStart = catalogMutations;

      const start = performance.now();
      const installedExtensions: ExtensionInfo[] = [];
      const contributionPoints: ContributionPoints = {
        messageConverters: [],
        panels: {},
        panelSettings: {},
        topicAliasFunctions: [],
        cameraModels: new Map(),
      };

      const listLoader = async (loader: IExtensionLoader): Promise<LoaderListing> => {
        try {
          const extensions = await loader.getExtensions();
          return {
            loader,
            extensions: extensions.map((extension) => withBundledFlag(extension, loader)),
          };
        } catch (err: unknown) {
          log.error("Error loading extension list", err);
          return { loader, extensions: [] };
        }
      };

      const localAndRemoteLoaders = loaders.filter(
        (loader) => loader.namespace === "local" || loader.type === "server",
      );
      // List every loader before loading any extension code, so that when an extension is both
      // bundled and installed, only the winning copy is loaded.
      let listings = await Promise.all(
        localAndRemoteLoaders.map(async (loader) => await listLoader(loader)),
      );
      try {
        listings = resolveBundledPrecedence(listings);
      } catch (err: unknown) {
        log.error("Error resolving bundled extensions; loading every copy", err);
      }
      await Promise.all(
        listings.map(async ({ loader, extensions }) => {
          await loadInBatch({ batch: extensions, contributionPoints, installedExtensions, loader });
        }),
      );

      if (generation !== refreshGeneration) {
        log.debug("Discarding the result of a superseded extension refresh");
        return;
      }
      if (catalogMutations !== mutationsAtStart) {
        log.debug("Extensions changed during the refresh; refreshing again");
        await get().refreshAllExtensions();
        return;
      }

      log.info(
        `Loaded ${installedExtensions.length} extensions in ${(performance.now() - start).toFixed(1)}ms`,
      );

      set({
        installedExtensions,
        installedPanels: contributionPoints.panels,
        installedMessageConverters: contributionPoints.messageConverters,
        installedTopicAliasFunctions: contributionPoints.topicAliasFunctions,
        installedCameraModels: contributionPoints.cameraModels,
        panelSettings: contributionPoints.panelSettings,
      });
    };

    const uninstallExtension = async (namespace: Namespace, id: string) => {
      const localLoaderType = isDesktopApp() ? "filesystem" : "browser";
      const loaderType: TypeExtensionLoader = namespace === "local" ? localLoaderType : "server";

      const namespaceLoader = loaders.find(
        (loader) => loader.namespace === namespace && loader.type === loaderType,
      );
      if (!namespaceLoader) {
        throw new Error("No extension loader found for namespace " + namespace);
      }

      const extension = get().installedExtensions?.find(
        (ext) => ext.id === id && ext.namespace === namespace,
      );

      if (!extension) {
        return;
      }
      // Refuse before touching any loader: the loader call below swallows errors and the state
      // update after it would drop the extension's panels until the next launch.
      if (extension.bundled === true) {
        throw new Error(
          `${extension.displayName || extension.id} ships with the app and cannot be uninstalled`,
        );
      }

      try {
        await namespaceLoader.uninstallExtension(
          loaderType === "server" ? extension.externalId! : extension.id,
        );
      } catch (error) {
        log.warn(
          `Failed to uninstall extension ${extension.id} from loader ${namespaceLoader.type}:`,
          error,
        );
      }

      catalogMutations++;
      set((state) =>
        removeExtensionData({ id: extension.id, namespace: extension.namespace!, state }),
      );

      const stillInstalled = get().installedExtensions?.some((ext) => ext.id === id) ?? false;
      if (!stillInstalled) {
        get().unMarkExtensionAsInstalled(id);
      }

      if (await anyMatchesBundled([extension])) {
        // The bundled copy this one was shadowing becomes active again.
        await get().refreshAllExtensions();
      }
    };

    return {
      downloadExtension,
      installExtensions,
      isExtensionInstalled,
      markExtensionAsInstalled,
      mergeState,
      refreshAllExtensions,
      uninstallExtension,
      unMarkExtensionAsInstalled,
      installedExtensions: loaders.length === 0 ? [] : undefined,
      installedMessageConverters: mockMessageConverters ?? [],
      installedPanels: {},
      installedTopicAliasFunctions: [],
      installedCameraModels: new Map(),
      loadedExtensions: new Set<string>(),
      panelSettings: _.merge(
        {},
        ...(mockMessageConverters ?? []).map(({ fromSchemaName, panelSettings }) =>
          _.mapValues(panelSettings, (settings) => ({ [fromSchemaName]: settings })),
        ),
      ),
    };
  });
}

export default function ExtensionCatalogProvider({
  children,
  loaders,
  mockMessageConverters,
}: PropsWithChildren<{
  loaders: readonly IExtensionLoader[];
  mockMessageConverters?: readonly RegisterMessageConverterArgs<unknown>[];
}>): React.JSX.Element {
  const [store] = useState(createExtensionRegistryStore(loaders, mockMessageConverters));

  // Request an initial refresh on first mount
  const refreshAllExtensions = store.getState().refreshAllExtensions;
  useEffect(() => {
    refreshAllExtensions().catch((err: unknown) => {
      log.error(err);
    });
  }, [refreshAllExtensions]);

  return (
    <ExtensionCatalogContext.Provider value={store}>{children}</ExtensionCatalogContext.Provider>
  );
}
