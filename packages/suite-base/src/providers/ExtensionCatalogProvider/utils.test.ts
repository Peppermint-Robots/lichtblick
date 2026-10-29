// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { IExtensionLoader } from "@lichtblick/suite-base/services/extension/IExtensionLoader";
import ExtensionBuilder from "@lichtblick/suite-base/testing/builders/ExtensionBuilder";
import { ExtensionInfo } from "@lichtblick/suite-base/types/Extensions";

import { isSameExtension, LoaderListing, resolveBundledPrecedence, withBundledFlag } from "./utils";

function loaderOfType(type: IExtensionLoader["type"]): IExtensionLoader {
  return {
    namespace: "local",
    type,
    getExtension: jest.fn(),
    getExtensions: jest.fn(),
    loadExtension: jest.fn(),
    installExtension: jest.fn(),
    uninstallExtension: jest.fn(),
  };
}

function extension(props: Partial<ExtensionInfo>): ExtensionInfo {
  return ExtensionBuilder.extensionInfo({ namespace: "local", ...props });
}

describe("isSameExtension", () => {
  it("matches entries with the same id", () => {
    expect(isSameExtension(extension({ id: "a.b" }), extension({ id: "a.b" }))).toBe(true);
  });

  it("matches a desktop-style id through the shared qualifiedName", () => {
    const browser = extension({ id: "Foxglove Inc.turtlesim", qualifiedName: "turtlesim" });
    const desktop = extension({ id: "foxgloveinc.turtlesim", qualifiedName: "turtlesim" });
    expect(isSameExtension(browser, desktop)).toBe(true);
  });

  it("does not match different extensions, or on an empty qualifiedName", () => {
    expect(
      isSameExtension(
        extension({ id: "a.one", qualifiedName: "one" }),
        extension({ id: "a.two", qualifiedName: "two" }),
      ),
    ).toBe(false);
    expect(
      isSameExtension(
        extension({ id: "a.one", qualifiedName: "" }),
        extension({ id: "a.two", qualifiedName: "" }),
      ),
    ).toBe(false);
  });
});

describe("withBundledFlag", () => {
  it("marks entries from a bundled loader", () => {
    expect(withBundledFlag(extension({}), loaderOfType("bundled")).bundled).toBe(true);
  });

  it("drops a bundled flag claimed by any other loader's entry", () => {
    const claimed = extension({ bundled: true });
    expect(withBundledFlag(claimed, loaderOfType("browser"))).not.toHaveProperty("bundled");
  });

  it("returns other entries unchanged", () => {
    const plain = extension({});
    expect(withBundledFlag(plain, loaderOfType("filesystem"))).toBe(plain);
  });
});

describe("resolveBundledPrecedence", () => {
  const bundledLoader = loaderOfType("bundled");
  const userLoader = loaderOfType("browser");

  function resolve(bundled: ExtensionInfo[], installed: ExtensionInfo[]): LoaderListing[] {
    return resolveBundledPrecedence([
      { loader: userLoader, extensions: installed },
      { loader: bundledLoader, extensions: bundled },
    ]);
  }

  it.each([
    ["newer", "1.5.0"],
    ["equal", "1.4.1"],
    ["non-numeric", "1.5.0-beta"],
  ])("keeps a %s installed copy and drops the bundled one", (_case, installedVersion) => {
    const bundled = extension({ id: "x.ext", version: "1.4.1" });
    const installed = extension({ id: "x.ext", version: installedVersion });

    const [user, bundledListing] = resolve([bundled], [installed]);

    expect(user!.extensions).toEqual([installed]);
    expect(bundledListing!.extensions).toEqual([]);
  });

  it("drops an older installed copy and keeps the bundled one", () => {
    const bundled = extension({ id: "x.ext", version: "1.4.1" });
    const installed = extension({ id: "x.ext", version: "1.2.0" });

    const [user, bundledListing] = resolve([bundled], [installed]);

    expect(user!.extensions).toEqual([]);
    expect(bundledListing!.extensions).toEqual([bundled]);
  });

  it("leaves unrelated extensions alone", () => {
    const bundled = extension({ id: "x.bundled" });
    const installed = extension({ id: "x.installed" });

    const [user, bundledListing] = resolve([bundled], [installed]);

    expect(user!.extensions).toEqual([installed]);
    expect(bundledListing!.extensions).toEqual([bundled]);
  });
});
