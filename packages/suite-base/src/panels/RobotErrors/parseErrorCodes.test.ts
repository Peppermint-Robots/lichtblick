// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { formatAge, resolveErrors, updateFirstSeen } from "./activeErrors";
import { codesForSeverity, parseErrorCodes } from "./parseErrorCodes";

describe("parseErrorCodes", () => {
  it("parses a payload captured from the robot", () => {
    expect(
      parseErrorCodes(
        '{"error":["E001","E002"],"warnings":["W001","W002","W003","W004","W005"]}',
      ),
    ).toEqual({
      error: ["E001", "E002"],
      warnings: ["W001", "W002", "W003", "W004", "W005"],
    });
  });

  it("treats empty arrays as the healthy state, not as missing data", () => {
    expect(parseErrorCodes('{"error":[],"warnings":[]}')).toEqual({ error: [], warnings: [] });
  });

  it("tolerates either key being absent", () => {
    expect(parseErrorCodes('{"error":["E001"]}')).toEqual({ error: ["E001"], warnings: [] });
    expect(parseErrorCodes('{"warnings":["W002"]}')).toEqual({ error: [], warnings: ["W002"] });
    expect(parseErrorCodes("{}")).toEqual({ error: [], warnings: [] });
  });

  it("dedupes while preserving the publisher's priority order", () => {
    // E003 is pushed from two independent branches on the robot, so it can arrive twice.
    expect(parseErrorCodes('{"error":["E003","E001","E003"],"warnings":[]}')?.error).toEqual([
      "E003",
      "E001",
    ]);
  });

  it("drops non-string and blank entries", () => {
    expect(parseErrorCodes('{"error":["E001",null,42,"  ",""],"warnings":[]}')?.error).toEqual([
      "E001",
    ]);
  });

  it("returns undefined for malformed payloads so the last good state survives", () => {
    expect(parseErrorCodes(undefined)).toBeUndefined();
    expect(parseErrorCodes("")).toBeUndefined();
    expect(parseErrorCodes("not json")).toBeUndefined();
    expect(parseErrorCodes("[1,2,3]")).toBeUndefined();
    expect(parseErrorCodes('"a string"')).toBeUndefined();
  });

  it("selects the list matching the panel's severity", () => {
    const parsed = parseErrorCodes('{"error":["E001"],"warnings":["W002"]}');
    expect(codesForSeverity(parsed, "error")).toEqual(["E001"]);
    expect(codesForSeverity(parsed, "warning")).toEqual(["W002"]);
    expect(codesForSeverity(undefined, "error")).toEqual([]);
  });
});

describe("updateFirstSeen", () => {
  it("keeps the original timestamp while a code stays active", () => {
    const map = updateFirstSeen(new Map(), ["E001"], 10);
    updateFirstSeen(map, ["E001", "E002"], 50);
    expect(map.get("E001")).toBe(10);
    expect(map.get("E002")).toBe(50);
  });

  it("forgets a code once it clears, so a reappearance is timed afresh", () => {
    const map = updateFirstSeen(new Map(), ["E002"], 10);
    updateFirstSeen(map, [], 20);
    expect(map.has("E002")).toBe(false);
    updateFirstSeen(map, ["E002"], 30);
    expect(map.get("E002")).toBe(30);
  });

  it("does not advance while playback is paused", () => {
    // A paused player keeps emitting render states at the same currentTime, so the stored stamp
    // must not move and the derived age must stay put.
    const map = updateFirstSeen(new Map(), ["E001"], 10);
    for (let i = 0; i < 5; i++) {
      updateFirstSeen(map, ["E001"], 25);
    }
    expect(map.get("E001")).toBe(10);
    expect(formatAge(25 - map.get("E001")!)).toBe("15s");
  });

  it("re-stamps a code when the user scrubs back past its first appearance", () => {
    // Without this the age would render negative (and formatAge would blank it).
    const map = updateFirstSeen(new Map(), ["E001"], 300);
    updateFirstSeen(map, ["E001"], 120);
    expect(map.get("E001")).toBe(120);
  });
});

describe("resolveErrors", () => {
  const catalog = {
    E001: { title: "Test Fault", description: "Test remediation", severity: "error" as const },
  };
  const lookup = (code: string) => catalog[code as keyof typeof catalog];

  it("resolves known codes to their catalog text", () => {
    const [entry] = resolveErrors(["E001"], "error", new Map([["E001", 500]]), lookup, 1000);
    expect(entry).toMatchObject({
      code: "E001",
      title: "Test Fault",
      description: "Test remediation",
      unknown: false,
      firstSeen: 500,
    });
  });

  it("still shows a code the catalog does not know", () => {
    // External errors are injected raw on the robot and exist in no catalog; a stale bundled
    // catalog produces the same situation. Never drop them.
    const [entry] = resolveErrors(["X999"], "error", new Map(), lookup, 1000);
    expect(entry).toMatchObject({ code: "X999", title: "X999", unknown: true, description: "" });
  });

  it("takes severity from the array the code arrived in, not the catalog", () => {
    // E001 is an error in the catalog; if the robot published it under warnings, believe the robot.
    const [entry] = resolveErrors(["E001"], "warning", new Map(), lookup, 0);
    expect(entry?.severity).toBe("warning");
  });
});

describe("formatAge", () => {
  it.each([
    [0, "0s"],
    [3.2, "3s"],
    [59.999, "59s"],
    [60, "1m 00s"],
    [124, "2m 04s"],
    [3600, "1h 00m"],
    [4320, "1h 12m"],
  ])("formats %ss of playback time as %s", (seconds, expected) => {
    expect(formatAge(seconds)).toBe(expected);
  });

  it("returns empty for nonsense input", () => {
    expect(formatAge(-1)).toBe("");
    expect(formatAge(NaN)).toBe("");
  });
});
