// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import fs from "fs";
import JSZip from "jszip";

import {
  BUNDLED_EXTENSION_FETCH_TIMEOUT_MS,
  BundledExtensionLoader,
} from "./BundledExtensionLoader";

const EXT_FILE_TURTLESIM = `${__dirname}/../../test/fixtures/lichtblick.suite-extension-turtlesim-0.0.1.foxe`;
// Publisher "Foxglove Inc.": the browser loaders keep the space, the desktop loader lowercases and
// strips it, which is why the catalog matches bundled entries on qualifiedName as well as id.
const TURTLESIM_ID = "Foxglove Inc.studio-extension-turtlesim";
const TURTLESIM_URL = "https://app.test/turtlesim.foxe";

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function okResponse(bytes: Uint8Array): Partial<Response> {
  return { ok: true, status: 200, arrayBuffer: async () => arrayBufferOf(bytes) };
}

/** Serves `responses[url]` from a mocked global fetch; unknown URLs fail like a 404. */
function mockFetch(responses: Record<string, Partial<Response> | Error>): jest.Mock {
  const mock = jest.fn(async (url: string) => {
    const response = responses[url] ?? { ok: false, status: 404 };
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  (globalThis as { fetch?: unknown }).fetch = mock;
  return mock;
}

/** A broken entry is logged via log.warn; clear it so setupTestFramework's console guard passes. */
function expectSkipWarning(): void {
  expect(console.warn).toHaveBeenCalled();
  (console.warn as jest.Mock).mockClear();
}

describe("BundledExtensionLoader", () => {
  const turtlesim = new Uint8Array(fs.readFileSync(EXT_FILE_TURTLESIM));

  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
    jest.useRealTimers();
  });

  it("is a read-only loader in the local namespace", () => {
    const loader = new BundledExtensionLoader([]);
    expect(loader.namespace).toBe("local");
    expect(loader.type).toBe("bundled");
  });

  it("lists a bundled extension with the same id the browser loaders derive", async () => {
    mockFetch({ [TURTLESIM_URL]: okResponse(turtlesim) });
    const loader = new BundledExtensionLoader([TURTLESIM_URL]);

    const extensions = await loader.getExtensions();

    expect(extensions).toHaveLength(1);
    expect(extensions[0]).toMatchObject({
      id: TURTLESIM_ID,
      name: "studio-extension-turtlesim",
      displayName: "turtlesim",
      qualifiedName: "turtlesim",
      publisher: "Foxglove Inc.",
      version: "0.0.1",
      namespace: "local",
      size: turtlesim.length,
    });
    expect(extensions[0]!.readme).toContain("studio-extension-turtlesim");
    expect(extensions[0]!.changelog).toContain("version history");
    // The catalog marks entries as bundled based on the loader, not the loader itself.
    expect(extensions[0]!.bundled).toBeUndefined();
    await expect(loader.getExtension(TURTLESIM_ID)).resolves.toEqual(extensions[0]);
  });

  it("loads the extension's dist/extension.js", async () => {
    mockFetch({ [TURTLESIM_URL]: okResponse(turtlesim) });
    const loader = new BundledExtensionLoader([TURTLESIM_URL]);
    const expected = await (await JSZip.loadAsync(turtlesim))
      .file("dist/extension.js")!
      .async("string");

    await expect(loader.loadExtension(TURTLESIM_ID)).resolves.toEqual({ raw: expected });
  });

  it("fetches each bundled file only once", async () => {
    const fetchMock = mockFetch({ [TURTLESIM_URL]: okResponse(turtlesim) });
    const loader = new BundledExtensionLoader([TURTLESIM_URL]);

    await Promise.all([loader.getExtensions(), loader.getExtension(TURTLESIM_ID)]);
    await loader.loadExtension(TURTLESIM_ID);
    await loader.getExtensions();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never fetches when nothing is bundled", async () => {
    const fetchMock = mockFetch({});
    const loader = new BundledExtensionLoader([]);

    await expect(loader.getExtensions()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["the fetch rejects", new Error("network down")],
    ["the server answers with an HTTP error", { ok: false, status: 404 }],
    ["the file is not a zip", okResponse(new TextEncoder().encode("not a zip"))],
  ])("skips an entry when %s and still loads the others", async (_case, brokenResponse) => {
    const brokenUrl = "https://app.test/broken.foxe";
    mockFetch({ [TURTLESIM_URL]: okResponse(turtlesim), [brokenUrl]: brokenResponse });
    const loader = new BundledExtensionLoader([brokenUrl, TURTLESIM_URL]);

    const extensions = await loader.getExtensions();

    expect(extensions.map(({ id }) => id)).toEqual([TURTLESIM_ID]);
    expectSkipWarning();
  });

  it("skips an entry without dist/extension.js", async () => {
    const zip = await JSZip.loadAsync(turtlesim);
    zip.remove("dist/extension.js");
    const withoutCode = await zip.generateAsync({ type: "uint8array" });
    mockFetch({ [TURTLESIM_URL]: okResponse(withoutCode) });
    const loader = new BundledExtensionLoader([TURTLESIM_URL]);

    await expect(loader.getExtensions()).resolves.toEqual([]);
    expectSkipWarning();
  });

  it("skips an entry whose download stalls instead of holding up the others", async () => {
    jest.useFakeTimers();
    const stalledUrl = "https://app.test/stalled.foxe";
    const fetchMock = jest.fn(
      async (url: string, init?: RequestInit): Promise<Partial<Response>> =>
        url === stalledUrl
          ? await new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new Error("aborted"));
              });
            })
          : okResponse(turtlesim),
    );
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const loader = new BundledExtensionLoader([stalledUrl, TURTLESIM_URL]);

    const extensions = loader.getExtensions();
    await jest.advanceTimersByTimeAsync(BUNDLED_EXTENSION_FETCH_TIMEOUT_MS);

    expect((await extensions).map(({ id }) => id)).toEqual([TURTLESIM_ID]);
    expectSkipWarning();
  });

  it("rejects loading an unknown extension", async () => {
    mockFetch({ [TURTLESIM_URL]: okResponse(turtlesim) });
    const loader = new BundledExtensionLoader([TURTLESIM_URL]);

    await expect(loader.loadExtension("someone.unknown")).rejects.toThrow(
      "Bundled extension someone.unknown not found",
    );
  });

  it("cannot install or uninstall", async () => {
    const loader = new BundledExtensionLoader([]);

    await expect(loader.installExtension({ foxeFileData: turtlesim })).rejects.toThrow("read-only");
    await expect(loader.uninstallExtension(TURTLESIM_ID)).rejects.toThrow("read-only");
  });
});
