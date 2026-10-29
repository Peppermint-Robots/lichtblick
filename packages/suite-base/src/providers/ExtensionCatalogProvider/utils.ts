// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import Logger from "@lichtblick/log";
import {
  ExtensionCatalog,
  ExtensionData,
} from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { SingleLoaderInstallResult } from "@lichtblick/suite-base/providers/ExtensionCatalogProvider/types";
import { buildContributionPoints } from "@lichtblick/suite-base/providers/helpers/buildContributionPoints";
import { IExtensionLoader } from "@lichtblick/suite-base/services/extension/IExtensionLoader";
import compareVersions from "@lichtblick/suite-base/services/extension/utils/compareVersions";
import { Namespace } from "@lichtblick/suite-base/types";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

const log = Logger.getLogger(__filename);

// Returns 0 for server loaders (higher priority) and 1 for others, used to
// sort loaders so the server loader runs first during installation.
export function serverLoaderFirst(loader: IExtensionLoader): number {
  return loader.type === "server" ? 0 : 1;
}

// Unique key combining id and namespace to allow the same extension to exist
// in multiple scopes simultaneously.
export function extensionUniqueKey(ext: ExtensionInfo): string {
  return `${ext.id}-${ext.namespace}`;
}

// Whether two entries are copies of the same extension. Ids alone are not enough: the desktop
// loader derives ids differently from the browser loaders (it lowercases the publisher), so
// entries also match on qualifiedName, which prefixes the extension's panel ids.
export function isSameExtension(a: ExtensionInfo, b: ExtensionInfo): boolean {
  return a.id === b.id || (Boolean(a.qualifiedName) && a.qualifiedName === b.qualifiedName);
}

// `bundled` records which loader an entry came from; never trust a value spread in from an
// extension's package.json.
export function withBundledFlag(extension: ExtensionInfo, loader: IExtensionLoader): ExtensionInfo {
  if (loader.type === "bundled") {
    return { ...extension, bundled: true };
  }
  return extension.bundled == undefined ? extension : _.omit(extension, "bundled");
}

export type LoaderListing = { loader: IExtensionLoader; extensions: ExtensionInfo[] };

// Whether `copy` has a lower version than `other`. False when either version is missing or not
// purely numeric (a package.json is not required to have one), so such copies are never "older".
export function isOlderVersion(copy: ExtensionInfo, other: ExtensionInfo): boolean {
  const a: unknown = copy.version;
  const b: unknown = other.version;
  return typeof a === "string" && typeof b === "string" && compareVersions(a, b) < 0;
}

// When an extension is both bundled with the app and installed (locally or by the organization),
// keep the installed copy unless it is older than the bundled one. Losing entries are dropped, so
// they are neither loaded nor listed. Missing or non-numeric versions: the installed copy wins.
export function resolveBundledPrecedence(listings: readonly LoaderListing[]): LoaderListing[] {
  const isBundled = ({ loader }: LoaderListing) => loader.type === "bundled";
  const installed = listings
    .filter((listing) => !isBundled(listing))
    .flatMap(({ extensions }) => extensions);
  const bundled = listings.filter(isBundled).flatMap(({ extensions }) => extensions);
  const losers = new Set<ExtensionInfo>();
  for (const bundledExtension of bundled) {
    for (const copy of installed.filter((ext) => isSameExtension(ext, bundledExtension))) {
      losers.add(isOlderVersion(copy, bundledExtension) ? copy : bundledExtension);
    }
  }
  return listings.map((listing) => ({
    ...listing,
    extensions: listing.extensions.filter((extension) => !losers.has(extension)),
  }));
}

async function tryLoadFromCache(
  extension: ExtensionInfo,
  orgCacheLoader: IExtensionLoader | undefined,
): Promise<string | undefined> {
  if (!orgCacheLoader) {
    return undefined;
  }
  const cachedExtension = await orgCacheLoader.getExtension(extension.id);
  if (!cachedExtension) {
    log.debug(`No cached version found for extension ${extension.id}, will load from remote.`);
    return undefined;
  }
  const isSameVersion = compareVersions(cachedExtension.version, extension.version) === 0;
  if (!isSameVersion) {
    log.debug(
      `Cached version differs from remote (cached: ${cachedExtension.version}, remote: ${extension.version}), using remote version.`,
    );
    return undefined;
  }
  log.debug(
    `Using cached version of extension ${extension.id} (version ${cachedExtension.version})`,
  );
  const { raw } = await orgCacheLoader.loadExtension(extension.id);
  return raw;
}

export async function loadSingleExtension(
  extension: ExtensionInfo,
  loader: IExtensionLoader,
  orgCacheLoader: IExtensionLoader | undefined,
): Promise<string> {
  if (loader.namespace === "org" && loader.type === "server" && extension.externalId) {
    const cachedSource = await tryLoadFromCache(extension, orgCacheLoader).catch((err: unknown) => {
      log.warn(`Cache lookup failed for ${extension.id}, falling back to remote`, err);
      return undefined;
    });

    if (cachedSource == undefined) {
      const { raw, buffer } = await loader.loadExtension(extension.externalId);
      if (buffer && orgCacheLoader) {
        await orgCacheLoader.installExtension({ foxeFileData: buffer }).catch((err: unknown) => {
          log.warn(`Failed to cache extension ${extension.id}`, err);
        });
      }
      return raw;
    }
    return cachedSource;
  }
  const { raw } = await loader.loadExtension(extension.id);
  return raw;
}

export function removeExtensionData({
  id, // deleted extension id
  namespace, // deleted extension namespace
  state,
}: {
  id: string;
  namespace: Namespace;
  state: Pick<
    ExtensionCatalog,
    | "installedExtensions"
    | "installedPanels"
    | "installedMessageConverters"
    | "installedTopicAliasFunctions"
    | "installedCameraModels"
  >;
}): Pick<
  ExtensionCatalog,
  | "installedExtensions"
  | "installedPanels"
  | "installedMessageConverters"
  | "installedTopicAliasFunctions"
  | "installedCameraModels"
> {
  const {
    installedExtensions,
    installedPanels,
    installedMessageConverters,
    installedTopicAliasFunctions,
    installedCameraModels,
  } = state;

  const remainingExtensions = installedExtensions?.filter(
    (ext) => !(ext.id === id && ext.namespace === namespace),
  );

  const stillInstalledElsewhere = remainingExtensions?.some((ext) => ext.id === id) ?? false;

  return {
    installedExtensions: remainingExtensions,
    installedPanels: stillInstalledElsewhere
      ? installedPanels
      : _.pickBy(installedPanels, ({ extensionId }) => extensionId !== id),
    installedMessageConverters: stillInstalledElsewhere
      ? installedMessageConverters
      : installedMessageConverters?.filter(({ extensionId }) => extensionId !== id),
    installedTopicAliasFunctions: stillInstalledElsewhere
      ? installedTopicAliasFunctions
      : installedTopicAliasFunctions?.filter(({ extensionId }) => extensionId !== id),
    installedCameraModels: stillInstalledElsewhere
      ? installedCameraModels
      : new Map([...installedCameraModels].filter(([, { extensionId }]) => extensionId !== id)),
  };
}
// Returns the extension id to use when calling loader.loadExtension after installation.
export function getExtensionLoadId(loader: IExtensionLoader, info: ExtensionInfo): string {
  return loader.namespace === "org" && loader.type === "server" ? info.externalId! : info.id;
}

export async function tryInstallSingleLoader(
  loader: IExtensionLoader,
  extension: ExtensionData,
  currentExternalId: string | undefined,
): Promise<SingleLoaderInstallResult> {
  try {
    const info = withBundledFlag(
      await loader.installExtension({
        foxeFileData: extension.buffer,
        file: extension.file,
        externalId: loader.type === "server" ? undefined : currentExternalId,
      }),
      loader,
    );
    const externalId = loader.type === "server" ? info.externalId : undefined;
    const { raw } = await loader.loadExtension(getExtensionLoadId(loader, info));
    const contributionPoints = buildContributionPoints(info, raw);
    return { loaderType: loader.type, success: true, info, contributionPoints, externalId };
  } catch (error) {
    return {
      loaderType: loader.type,
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
