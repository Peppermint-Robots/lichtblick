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
    const topics = [topic("/robot_a/odom"), topic("/robot_a/scan"), topic("/robot_a/tf")];
    expect(detectRobotNamespace(topics, {})).toBe("robot_a");
  });

  it("returns undefined when no topics are namespaced", () => {
    expect(detectRobotNamespace([topic("/odom"), topic("/scan")], {})).toBeUndefined();
  });

  it("picks the namespace with the most topics, tie-broken lexicographically", () => {
    expect(
      detectRobotNamespace(
        [topic("/other_bot/odom"), topic("/robot_a/odom"), topic("/robot_a/scan")],
        {},
      ),
    ).toBe("robot_a");
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
      topic("/robot_a/odom"),
    ];
    expect(detectRobotNamespace(topics, {})).toBe("robot_a");
  });

  it("honors the robot_id global variable override", () => {
    const topics = [topic("/robot_a/odom"), topic("/robot_a/scan"), topic("/other_bot/odom")];
    expect(detectRobotNamespace(topics, { [ROBOT_ID_VARIABLE]: "other_bot" })).toBe("other_bot");
    expect(detectRobotNamespace(topics, { [ROBOT_ID_VARIABLE]: "/other_bot" })).toBe("other_bot");
    expect(detectRobotNamespace(topics, { [ROBOT_ID_VARIABLE]: "" })).toBe("robot_a");
    expect(detectRobotNamespace(topics, { [ROBOT_ID_VARIABLE]: 42 })).toBe("robot_a");
  });
});

describe("rewriteTopicReference", () => {
  const topics = new Set(["/robot_a/odom", "/robot_a/scan", "/robot_a/nav/path", "/tf"]);

  it("rewrites a generic topic to the namespaced topic", () => {
    expect(rewriteTopicReference("/odom", topics, "robot_a")).toBe("/robot_a/odom");
    expect(rewriteTopicReference("/nav/path", topics, "robot_a")).toBe("/robot_a/nav/path");
  });

  it("rewrites a topic namespaced under a different robot", () => {
    expect(rewriteTopicReference("/robot_b/odom", topics, "robot_a")).toBe("/robot_a/odom");
  });

  it("preserves the message-path portion", () => {
    expect(rewriteTopicReference("/odom.twist.twist.linear.x", topics, "robot_a")).toBe(
      "/robot_a/odom.twist.twist.linear.x",
    );
    expect(rewriteTopicReference("/robot_b/odom.pose{x==1}", topics, "robot_a")).toBe(
      "/robot_a/odom.pose{x==1}",
    );
  });

  it("leaves references that exist in the source untouched", () => {
    expect(rewriteTopicReference("/tf", topics, "robot_a")).toBeUndefined();
    expect(rewriteTopicReference("/robot_a/odom", topics, "robot_a")).toBeUndefined();
  });

  it("returns undefined when no matching namespaced topic exists", () => {
    expect(rewriteTopicReference("/camera/image", topics, "robot_a")).toBeUndefined();
    expect(rewriteTopicReference("not-a-topic", topics, "robot_a")).toBeUndefined();
  });

  it("re-namespaces a robot-ID reference even when the topic is absent from the source", () => {
    // AB0000001 looks like a robot ID, so the reference is adapted to the connected robot even
    // though it does not publish status_topic — the panel then shows the current
    // robot's topic name and binds if the topic appears later on a live connection.
    expect(rewriteTopicReference("/AB0000001/status_topic.status", topics, "AB0000005")).toBe(
      "/AB0000005/status_topic.status",
    );
    expect(rewriteTopicReference("/AB0000006/scan", topics, "robot_a")).toBe("/robot_a/scan");
  });

  it("does not force-rewrite functional first segments when the topic is absent", () => {
    // move_base_simple / zone_monitor are part of the real topic name, not a robot namespace.
    expect(rewriteTopicReference("/move_base_simple/goal", topics, "robot_a")).toBeUndefined();
    expect(rewriteTopicReference("/zone_monitor/lidar/region", topics, "robot_a")).toBeUndefined();
  });

  it("returns undefined when the reference is already under the current namespace", () => {
    expect(rewriteTopicReference("/AB0000005/status_topic", topics, "AB0000005")).toBeUndefined();
  });
});

describe("rewriteConfigTopics", () => {
  const topics = new Set(["/robot_a/map", "/robot_a/scan", "/robot_a/odom"]);

  it("rewrites topic keys and string values recursively", () => {
    const config = {
      topics: {
        "/map": { visible: true },
        "/robot_b/scan": { visible: true, colorField: "intensity" },
      },
      paths: [{ value: "/odom.twist.twist.linear.x", enabled: true }],
      followTf: "map",
    };

    const result = rewriteConfigTopics(config, topics, "robot_a");
    expect(result.changed).toBe(true);
    expect(result.config).toEqual({
      topics: {
        "/robot_a/map": { visible: true },
        "/robot_a/scan": { visible: true, colorField: "intensity" },
      },
      paths: [{ value: "/robot_a/odom.twist.twist.linear.x", enabled: true }],
      followTf: "map",
    });
  });

  it("returns the original object when nothing needs rewriting", () => {
    const config = {
      topics: { "/robot_a/map": { visible: true } },
      paths: [{ value: "/robot_a/odom.pose.x" }],
    };
    const result = rewriteConfigTopics(config, topics, "robot_a");
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
  });

  it("does not clobber an existing entry for the target topic", () => {
    const config = {
      topics: {
        "/robot_b/map": { visible: true },
        "/robot_a/map": { visible: false },
      },
    };
    const result = rewriteConfigTopics(config, topics, "robot_a");
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
  });

  it("handles non-object leaf values", () => {
    const result = rewriteConfigTopics({ a: 1, b: undefined, c: [true, "x"] }, topics, "robot_a");
    expect(result.changed).toBe(false);
  });

  // Real layouts accumulate per-topic settings for several robots, which all collapse onto the
  // same target key for the connected robot.
  describe("collisions between entries from multiple robot namespaces", () => {
    const targetRobotTopics = new Set(["/AB0000006/map", "/AB0000006/scan"]);

    it("keeps the enabled entry when a disabled one comes first", () => {
      const config = {
        topics: {
          "/AB0000004/map": { visible: false },
          "/AB0000001/map": { visible: false },
          "/AB0000002/map": { visible: true, maxColor: "#8f8f8fff" },
        },
      };
      const result = rewriteConfigTopics(config, targetRobotTopics, "AB0000006");
      expect(result.changed).toBe(true);
      expect(result.config).toEqual({
        topics: { "/AB0000006/map": { visible: true, maxColor: "#8f8f8fff" } },
      });
    });

    it("keeps the enabled entry when a disabled one comes last", () => {
      const config = {
        topics: {
          "/AB0000002/map": { visible: true, maxColor: "#8f8f8fff" },
          "/AB0000004/map": { visible: false },
        },
      };
      const result = rewriteConfigTopics(config, targetRobotTopics, "AB0000006");
      expect(result.config).toEqual({
        topics: { "/AB0000006/map": { visible: true, maxColor: "#8f8f8fff" } },
      });
    });

    it("keeps the first entry deterministically when none are enabled", () => {
      const config = {
        topics: {
          "/AB0000004/map": { visible: false, minColor: "#aaa" },
          "/AB0000001/map": { visible: false, minColor: "#bbb" },
        },
      };
      const result = rewriteConfigTopics(config, targetRobotTopics, "AB0000006");
      expect(result.config).toEqual({
        topics: { "/AB0000006/map": { visible: false, minColor: "#aaa" } },
      });
    });

    it("keeps the first enabled entry's settings when several are enabled", () => {
      const config = {
        topics: {
          "/AB0000001/scan": { visible: true, flatColor: "#ff004bff" },
          "/AB0000003/scan": { visible: true, flatColor: "#e2cf2aff" },
        },
      };
      const result = rewriteConfigTopics(config, targetRobotTopics, "AB0000006");
      expect(result.config).toEqual({
        topics: { "/AB0000006/scan": { visible: true, flatColor: "#ff004bff" } },
      });
    });
  });
});
