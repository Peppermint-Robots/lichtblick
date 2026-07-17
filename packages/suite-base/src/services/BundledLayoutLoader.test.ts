// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext";

import { BundledLayoutLoader } from "./BundledLayoutLoader";
import { BundledLayout } from "@lichtblick/suite-base/layouts";

const bundled: BundledLayout[] = [
  { name: "Robot Diagnostics", version: 1, data: {} as LayoutData },
];

function mockFetchResponse(response: Partial<Response> | Error): jest.Mock {
  const mock = jest.fn();
  if (response instanceof Error) {
    mock.mockRejectedValue(response);
  } else {
    mock.mockResolvedValue(response);
  }
  (globalThis as { fetch?: unknown }).fetch = mock;
  return mock;
}

describe("BundledLayoutLoader", () => {
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it("returns bundled layouts when no manifest is served", async () => {
    mockFetchResponse({ ok: false, status: 404 });
    const loader = new BundledLayoutLoader(bundled);

    const layouts = await loader.fetchLayouts();
    expect(layouts).toEqual([
      { name: "Robot Diagnostics", from: "web:Robot Diagnostics@1", data: {} },
    ]);
  });

  it("fetches the manifest from the layoutsUrl when provided", async () => {
    const fetchMock = mockFetchResponse({ ok: false, status: 404 });
    const loader = new BundledLayoutLoader(bundled, "https://host.example/layouts.json");

    await loader.fetchLayouts();
    expect(fetchMock).toHaveBeenCalledWith("https://host.example/layouts.json");
  });

  it("lets manifest layouts override bundled layouts by name and adds new ones", async () => {
    mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({
        layouts: [
          { name: "Robot Diagnostics", version: 5, data: { fromHost: true } },
          { name: "Navigation", version: 1, data: {} },
        ],
      }),
    });
    const loader = new BundledLayoutLoader(bundled);

    const layouts = await loader.fetchLayouts();
    expect(layouts).toEqual([
      { name: "Robot Diagnostics", from: "web:Robot Diagnostics@5", data: { fromHost: true } },
      { name: "Navigation", from: "web:Navigation@1", data: {} },
    ]);
  });

  it("falls back to bundled layouts when the manifest fetch fails", async () => {
    mockFetchResponse(new Error("network down"));
    const loader = new BundledLayoutLoader(bundled);

    const layouts = await loader.fetchLayouts();
    expect(layouts).toEqual([
      { name: "Robot Diagnostics", from: "web:Robot Diagnostics@1", data: {} },
    ]);
  });

  it("ignores a malformed manifest", async () => {
    mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({ notLayouts: [] }),
    });
    const loader = new BundledLayoutLoader(bundled);

    const layouts = await loader.fetchLayouts();
    expect(layouts).toEqual([
      { name: "Robot Diagnostics", from: "web:Robot Diagnostics@1", data: {} },
    ]);
    // A manifest without a "layouts" array is logged via log.warn; clear the expected warning so
    // the global console.warn guard in setupTestFramework does not fail the test.
    expect(console.warn).toHaveBeenCalled();
    (console.warn as jest.Mock).mockClear();
  });

  it("filters manifest entries missing required fields", async () => {
    mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({
        layouts: [
          { name: "", version: 1, data: {} },
          { name: "No Version", data: {} },
          { name: "No Data", version: 1 },
          { name: "Valid", version: 2, data: {} },
        ],
      }),
    });
    const loader = new BundledLayoutLoader([]);

    const layouts = await loader.fetchLayouts();
    expect(layouts).toEqual([{ name: "Valid", from: "web:Valid@2", data: {} }]);
  });
});
