/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook, waitFor } from "@testing-library/react";
import fs from "fs";

import { useExtensionCatalog } from "@lichtblick/suite-base/context/ExtensionCatalogContext";
import { IExtensionLoader } from "@lichtblick/suite-base/services/extension/IExtensionLoader";
import ExtensionBuilder from "@lichtblick/suite-base/testing/builders/ExtensionBuilder";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

import ExtensionCatalogProvider from "./ExtensionCatalogProvider";

jest.mock("@lichtblick/suite-base/util/isDesktopApp", () => jest.fn());

const SOURCE = `module.exports = { activate: function() { return 1; } }`;

/** Source of an extension that registers one message converter, to observe which copy is active. */
function converterSource(toSchemaName: string): string {
  return `module.exports = { activate: function(ctx) { ctx.registerMessageConverter({
    fromSchemaName: "in.Schema", toSchemaName: "${toSchemaName}", converter: function(m) { return m; },
  }); } }`;
}

const TURTLESIM_FOXE = `${__dirname}/../../test/fixtures/lichtblick.suite-extension-turtlesim-0.0.1.foxe`;

function extension(props: Partial<ExtensionInfo>): ExtensionInfo {
  return ExtensionBuilder.extensionInfo({ namespace: "local", ...props });
}

/** A loader plus its method mocks, kept separately so assertions don't detach interface methods. */
type MockLoader = {
  loader: IExtensionLoader;
  getExtensions: jest.Mock;
  loadExtension: jest.Mock;
  installExtension: jest.Mock;
  uninstallExtension: jest.Mock;
};

function mockLoader(type: IExtensionLoader["type"], mocks: Omit<MockLoader, "loader">): MockLoader {
  return { loader: { namespace: "local", type, getExtension: jest.fn(), ...mocks }, ...mocks };
}

function bundledLoader(extensions: ExtensionInfo[], source = SOURCE): MockLoader {
  return mockLoader("bundled", {
    getExtensions: jest.fn().mockResolvedValue(extensions),
    loadExtension: jest.fn().mockResolvedValue({ raw: source }),
    installExtension: jest.fn().mockRejectedValue(new Error("read-only")),
    uninstallExtension: jest.fn().mockRejectedValue(new Error("read-only")),
  });
}

/** A writable "local" loader backed by an in-memory list, like IndexedDB on web. */
function userLoader(
  initial: ExtensionInfo[],
  toInstall?: ExtensionInfo,
  source = SOURCE,
): MockLoader {
  const stored = [...initial];
  return mockLoader("browser", {
    getExtensions: jest.fn(async () => [...stored]),
    loadExtension: jest.fn().mockResolvedValue({ raw: source }),
    installExtension: jest.fn(async () => {
      stored.push(toInstall!);
      return toInstall!;
    }),
    uninstallExtension: jest.fn(async (id: string) => {
      stored.splice(
        stored.findIndex((ext) => ext.id === id),
        1,
      );
    }),
  });
}

async function renderCatalog(loaders: IExtensionLoader[]) {
  const { result } = renderHook(() => useExtensionCatalog((state) => state), {
    wrapper: ({ children }) => (
      <ExtensionCatalogProvider loaders={loaders}>{children}</ExtensionCatalogProvider>
    ),
  });
  await waitFor(() => {
    expect(result.current.installedExtensions).toBeDefined();
  });
  return result;
}

const ids = (extensions: readonly ExtensionInfo[] | undefined) =>
  (extensions ?? []).map(({ id, version, bundled }) => ({ id, version, bundled }));

describe("ExtensionCatalogProvider with bundled extensions", () => {
  const bundledCopy = extension({ id: "acme.tool", qualifiedName: "Tool", version: "1.4.0" });

  it("loads a bundled extension and marks it as bundled", async () => {
    const bundled = bundledLoader([bundledCopy]);

    const result = await renderCatalog([bundled.loader, userLoader([]).loader]);

    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acme.tool", version: "1.4.0", bundled: true },
    ]);
    expect(bundled.loadExtension).toHaveBeenCalledWith("acme.tool");
    expect(result.current.isExtensionInstalled("acme.tool")).toBe(true);
  });

  it("prefers an installed copy that is not older, even when its loader answers last", async () => {
    const installedCopy = extension({ id: "acme.tool", qualifiedName: "Tool", version: "1.4.0" });
    const bundled = bundledLoader([bundledCopy]);
    const user = userLoader([installedCopy]);
    let releaseUser: () => void = () => {};
    user.getExtensions.mockImplementationOnce(
      async () =>
        await new Promise<ExtensionInfo[]>((resolve) => {
          releaseUser = () => {
            resolve([installedCopy]);
          };
        }),
    );

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[bundled.loader, user.loader]}>
          {children}
        </ExtensionCatalogProvider>
      ),
    });
    await waitFor(() => {
      expect(bundled.getExtensions).toHaveBeenCalled();
    });
    await act(async () => {
      releaseUser();
    });
    await waitFor(() => {
      expect(result.current.installedExtensions).toBeDefined();
    });

    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acme.tool", version: "1.4.0", bundled: undefined },
    ]);
    expect(bundled.loadExtension).not.toHaveBeenCalled();
    expect(user.loadExtension).toHaveBeenCalledWith("acme.tool");
  });

  it("prefers the bundled copy over an older installed one", async () => {
    const staleCopy = extension({ id: "acme.tool", qualifiedName: "Tool", version: "1.2.0" });
    const bundled = bundledLoader([bundledCopy]);
    const user = userLoader([staleCopy]);

    const result = await renderCatalog([bundled.loader, user.loader]);

    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acme.tool", version: "1.4.0", bundled: true },
    ]);
    expect(user.loadExtension).not.toHaveBeenCalled();
  });

  it("recognises a desktop-style id for the same extension through its qualifiedName", async () => {
    const desktopCopy = extension({ id: "acmeinc.tool", qualifiedName: "Tool", version: "1.5.0" });
    const bundled = bundledLoader([bundledCopy]);

    const result = await renderCatalog([bundled.loader, userLoader([desktopCopy]).loader]);

    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acmeinc.tool", version: "1.5.0", bundled: undefined },
    ]);
    expect(bundled.loadExtension).not.toHaveBeenCalled();
  });

  it("never installs into the bundled loader", async () => {
    const unrelated = extension({ id: "other.ext", qualifiedName: "Other" });
    const bundled = bundledLoader([bundledCopy]);
    const user = userLoader([], unrelated);
    const result = await renderCatalog([bundled.loader, user.loader]);

    let installResults: Awaited<ReturnType<typeof result.current.installExtensions>> = [];
    await act(async () => {
      installResults = await result.current.installExtensions("local", [
        { buffer: new Uint8Array() },
      ]);
    });

    expect(bundled.installExtension).not.toHaveBeenCalled();
    expect(installResults).toHaveLength(1);
    expect(installResults[0]).toMatchObject({ success: true, error: undefined });
  });

  it("refuses to uninstall a bundled extension without touching any loader", async () => {
    const bundled = bundledLoader([bundledCopy]);
    const user = userLoader([]);
    const result = await renderCatalog([bundled.loader, user.loader]);

    await act(async () => {
      await expect(result.current.uninstallExtension("local", "acme.tool")).rejects.toThrow(
        "ships with the app",
      );
    });

    expect(user.uninstallExtension).not.toHaveBeenCalled();
    expect(bundled.uninstallExtension).not.toHaveBeenCalled();
    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acme.tool", version: "1.4.0", bundled: true },
    ]);
  });

  it("re-activates the bundled copy once the installed copy is uninstalled", async () => {
    const installedCopy = extension({ id: "acme.tool", qualifiedName: "Tool", version: "1.5.0" });
    const bundled = bundledLoader([bundledCopy]);
    const user = userLoader([installedCopy]);
    const result = await renderCatalog([bundled.loader, user.loader]);
    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acme.tool", version: "1.5.0", bundled: undefined },
    ]);

    await act(async () => {
      await result.current.uninstallExtension("local", "acme.tool");
    });

    expect(user.uninstallExtension).toHaveBeenCalledWith("acme.tool");
    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acme.tool", version: "1.4.0", bundled: true },
    ]);
    expect(bundled.loadExtension).toHaveBeenCalledWith("acme.tool");
    expect(result.current.isExtensionInstalled("acme.tool")).toBe(true);
  });

  it("switches to an installed copy as soon as it is installed", async () => {
    const newerCopy = extension({ id: "acme.tool", qualifiedName: "Tool", version: "2.0.0" });
    const bundled = bundledLoader([bundledCopy], converterSource("from.bundled"));
    const user = userLoader([], newerCopy, converterSource("from.user"));
    const result = await renderCatalog([bundled.loader, user.loader]);
    const converters = () =>
      result.current.installedMessageConverters?.map(({ toSchemaName }) => toSchemaName);
    expect(converters()).toEqual(["from.bundled"]);

    await act(async () => {
      await result.current.installExtensions("local", [{ buffer: new Uint8Array() }]);
    });

    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acme.tool", version: "2.0.0", bundled: undefined },
    ]);
    // Only a full refresh drops the bundled copy's converter; merging the install would keep both.
    expect(converters()).toEqual(["from.user"]);
  });

  it("refuses to install a copy older than the bundled one", async () => {
    // The fixture is turtlesim 0.0.1; the bundled copy of the same extension is newer.
    const bundledTurtlesim = extension({
      id: "Foxglove Inc.studio-extension-turtlesim",
      qualifiedName: "turtlesim",
      version: "1.0.0",
    });
    const bundled = bundledLoader([bundledTurtlesim]);
    const user = userLoader([], bundledTurtlesim);
    const result = await renderCatalog([bundled.loader, user.loader]);

    let installResults: Awaited<ReturnType<typeof result.current.installExtensions>> = [];
    await act(async () => {
      installResults = await result.current.installExtensions("local", [
        { buffer: new Uint8Array(fs.readFileSync(TURTLESIM_FOXE)) },
      ]);
    });

    expect(user.installExtension).not.toHaveBeenCalled();
    expect(installResults[0]).toMatchObject({ success: false });
    expect(String(installResults[0]!.error)).toContain(
      "turtlesim 0.0.1 is older than the version bundled with the app (1.0.0)",
    );
    expect(ids(result.current.installedExtensions)).toEqual([
      { id: bundledTurtlesim.id, version: "1.0.0", bundled: true },
    ]);
  });

  it("keeps an installed copy without a version instead of failing the refresh", async () => {
    const unversioned = extension({ id: "acme.tool", qualifiedName: "Tool" });
    (unversioned as { version?: string }).version = undefined;

    const result = await renderCatalog([
      bundledLoader([bundledCopy]).loader,
      userLoader([unversioned]).loader,
    ]);

    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acme.tool", version: undefined, bundled: undefined },
    ]);
  });

  it("does not restore an extension uninstalled while a refresh was running", async () => {
    const unrelated = extension({ id: "other.ext", qualifiedName: "Other" });
    const user = userLoader([unrelated]);
    const result = await renderCatalog([bundledLoader([]).loader, user.loader]);
    let releaseListing: () => void = () => {};
    user.getExtensions.mockImplementationOnce(
      async () =>
        await new Promise<ExtensionInfo[]>((resolve) => {
          releaseListing = () => {
            resolve([unrelated]); // listed before the uninstall below
          };
        }),
    );

    let refresh: Promise<void> = Promise.resolve();
    await act(async () => {
      refresh = result.current.refreshAllExtensions();
    });
    await act(async () => {
      await result.current.uninstallExtension("local", "other.ext");
    });
    await act(async () => {
      releaseListing();
      await refresh;
    });

    expect(result.current.installedExtensions).toEqual([]);
  });

  it("discards the result of an older refresh that finishes after a newer one", async () => {
    const before = extension({ id: "acme.before", qualifiedName: "Before" });
    const after = extension({ id: "acme.after", qualifiedName: "After" });
    const user = userLoader([after]);
    let releaseFirst: () => void = () => {};
    user.getExtensions.mockImplementationOnce(
      async () =>
        await new Promise<ExtensionInfo[]>((resolve) => {
          releaseFirst = () => {
            resolve([before]);
          };
        }),
    );

    const { result } = renderHook(() => useExtensionCatalog((state) => state), {
      wrapper: ({ children }) => (
        <ExtensionCatalogProvider loaders={[bundledLoader([]).loader, user.loader]}>
          {children}
        </ExtensionCatalogProvider>
      ),
    });
    // The mount refresh is now waiting on the first listing; a second refresh overtakes it.
    await waitFor(() => {
      expect(user.getExtensions).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await result.current.refreshAllExtensions();
    });
    await act(async () => {
      releaseFirst();
    });
    // Wait until the stale refresh has loaded its extension, i.e. reached the point of publishing.
    await waitFor(() => {
      expect(user.loadExtension).toHaveBeenCalledWith("acme.before");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ids(result.current.installedExtensions)).toEqual([
      { id: "acme.after", version: after.version, bundled: undefined },
    ]);
  });
});
