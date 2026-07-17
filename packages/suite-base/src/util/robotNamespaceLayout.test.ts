// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  detectRobotNamespace,
  rewriteConfigTopics,
  rewriteTopicReference,
  ROBOT_ID_VARIABLE,
} from "./robotNamespaceLayout";

const topic = (name: string) => ({ name, schemaName: "test" });

describe("detectRobotNamespace", () => {
  it("detects a single robot namespace", () => {
    const topics = [topic("/pmt_007/odom"), topic("/pmt_007/scan"), topic("/pmt_007/tf")];
    expect(detectRobotNamespace(topics, {})).toBe("pmt_007");
  });

  it("returns undefined when no topics are namespaced", () => {
    expect(detectRobotNamespace([topic("/odom"), topic("/scan")], {})).toBeUndefined();
  });

  it("picks the namespace with the most topics, tie-broken lexicographically", () => {
    expect(
      detectRobotNamespace(
        [topic("/other_bot/odom"), topic("/pmt_007/odom"), topic("/pmt_007/scan")],
        {},
      ),
    ).toBe("pmt_007");
    expect(
      detectRobotNamespace(
        [topic("/zeta/odom"), topic("/zeta/scan"), topic("/alpha/odom"), topic("/alpha/scan")],
        {},
      ),
    ).toBe("alpha");
  });

  it("ignores denylisted first segments", () => {
    const topics = [
      topic("/diagnostics/agg"),
      topic("/diagnostics/toplevel"),
      topic("/pmt_007/odom"),
    ];
    expect(detectRobotNamespace(topics, {})).toBe("pmt_007");
  });

  it("honors the robot_id global variable override", () => {
    const topics = [topic("/pmt_007/odom"), topic("/pmt_007/scan"), topic("/other_bot/odom")];
    expect(detectRobotNamespace(topics, { [ROBOT_ID_VARIABLE]: "other_bot" })).toBe("other_bot");
    expect(detectRobotNamespace(topics, { [ROBOT_ID_VARIABLE]: "/other_bot" })).toBe("other_bot");
    expect(detectRobotNamespace(topics, { [ROBOT_ID_VARIABLE]: "" })).toBe("pmt_007");
    expect(detectRobotNamespace(topics, { [ROBOT_ID_VARIABLE]: 42 })).toBe("pmt_007");
  });
});

describe("rewriteTopicReference", () => {
  const topics = new Set(["/pmt_007/odom", "/pmt_007/scan", "/pmt_007/nav/path", "/tf"]);

  it("rewrites a generic topic to the namespaced topic", () => {
    expect(rewriteTopicReference("/odom", topics, "pmt_007")).toBe("/pmt_007/odom");
    expect(rewriteTopicReference("/nav/path", topics, "pmt_007")).toBe("/pmt_007/nav/path");
  });

  it("rewrites a topic namespaced under a different robot", () => {
    expect(rewriteTopicReference("/pmt_001/odom", topics, "pmt_007")).toBe("/pmt_007/odom");
  });

  it("preserves the message-path portion", () => {
    expect(rewriteTopicReference("/odom.twist.twist.linear.x", topics, "pmt_007")).toBe(
      "/pmt_007/odom.twist.twist.linear.x",
    );
    expect(rewriteTopicReference("/pmt_001/odom.pose{x==1}", topics, "pmt_007")).toBe(
      "/pmt_007/odom.pose{x==1}",
    );
  });

  it("leaves references that exist in the source untouched", () => {
    expect(rewriteTopicReference("/tf", topics, "pmt_007")).toBeUndefined();
    expect(rewriteTopicReference("/pmt_007/odom", topics, "pmt_007")).toBeUndefined();
  });

  it("returns undefined when no matching namespaced topic exists", () => {
    expect(rewriteTopicReference("/camera/image", topics, "pmt_007")).toBeUndefined();
    expect(rewriteTopicReference("not-a-topic", topics, "pmt_007")).toBeUndefined();
  });
});

describe("rewriteConfigTopics", () => {
  const topics = new Set(["/pmt_007/map", "/pmt_007/scan", "/pmt_007/odom"]);

  it("rewrites topic keys and string values recursively", () => {
    const config = {
      topics: {
        "/map": { visible: true },
        "/pmt_001/scan": { visible: true, colorField: "intensity" },
      },
      paths: [{ value: "/odom.twist.twist.linear.x", enabled: true }],
      followTf: "map",
    };

    const result = rewriteConfigTopics(config, topics, "pmt_007");
    expect(result.changed).toBe(true);
    expect(result.config).toEqual({
      topics: {
        "/pmt_007/map": { visible: true },
        "/pmt_007/scan": { visible: true, colorField: "intensity" },
      },
      paths: [{ value: "/pmt_007/odom.twist.twist.linear.x", enabled: true }],
      followTf: "map",
    });
  });

  it("returns the original object when nothing needs rewriting", () => {
    const config = {
      topics: { "/pmt_007/map": { visible: true } },
      paths: [{ value: "/pmt_007/odom.pose.x" }],
    };
    const result = rewriteConfigTopics(config, topics, "pmt_007");
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
  });

  it("does not clobber an existing entry for the target topic", () => {
    const config = {
      topics: {
        "/pmt_001/map": { visible: true },
        "/pmt_007/map": { visible: false },
      },
    };
    const result = rewriteConfigTopics(config, topics, "pmt_007");
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
  });

  it("handles non-object leaf values", () => {
    const result = rewriteConfigTopics({ a: 1, b: undefined, c: [true, "x"] }, topics, "pmt_007");
    expect(result.changed).toBe(false);
  });

  // Real layouts accumulate per-topic settings for several robots, which all collapse onto the
  // same target key for the connected robot.
  describe("collisions between entries from multiple robot namespaces", () => {
    const mv500 = new Set(["/MV500PCA5011/map", "/MV500PCA5011/scan"]);

    it("keeps the enabled entry when a disabled one comes first", () => {
      const config = {
        topics: {
          "/SD0201000/map": { visible: false },
          "/SD0452000/map": { visible: false },
          "/SD0452027/map": { visible: true, maxColor: "#8f8f8fff" },
        },
      };
      const result = rewriteConfigTopics(config, mv500, "MV500PCA5011");
      expect(result.changed).toBe(true);
      expect(result.config).toEqual({
        topics: { "/MV500PCA5011/map": { visible: true, maxColor: "#8f8f8fff" } },
      });
    });

    it("keeps the enabled entry when a disabled one comes last", () => {
      const config = {
        topics: {
          "/SD0452027/map": { visible: true, maxColor: "#8f8f8fff" },
          "/SD0201000/map": { visible: false },
        },
      };
      const result = rewriteConfigTopics(config, mv500, "MV500PCA5011");
      expect(result.config).toEqual({
        topics: { "/MV500PCA5011/map": { visible: true, maxColor: "#8f8f8fff" } },
      });
    });

    it("keeps the first entry deterministically when none are enabled", () => {
      const config = {
        topics: {
          "/SD0201000/map": { visible: false, minColor: "#aaa" },
          "/SD0452000/map": { visible: false, minColor: "#bbb" },
        },
      };
      const result = rewriteConfigTopics(config, mv500, "MV500PCA5011");
      expect(result.config).toEqual({
        topics: { "/MV500PCA5011/map": { visible: false, minColor: "#aaa" } },
      });
    });

    it("keeps the first enabled entry's settings when several are enabled", () => {
      const config = {
        topics: {
          "/SD0452000/scan": { visible: true, flatColor: "#ff004bff" },
          "/SD0452026/scan": { visible: true, flatColor: "#e2cf2aff" },
        },
      };
      const result = rewriteConfigTopics(config, mv500, "MV500PCA5011");
      expect(result.config).toEqual({
        topics: { "/MV500PCA5011/scan": { visible: true, flatColor: "#ff004bff" } },
      });
    });
  });
});
