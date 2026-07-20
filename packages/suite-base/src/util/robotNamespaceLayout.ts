// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable, VariableValue } from "@lichtblick/suite";

/**
 * Robot-namespace layout adaptation.
 *
 * Peppermint robots publish topics under a per-robot namespace (`/<robot_id>/<topic>`). Layouts
 * (both the shipped defaults, which reference generic names like `/odom`, and user layouts saved
 * while connected to a specific robot, which reference e.g. `/pmt_007/odom`) are adapted to the
 * connected data source by rewriting topic references in panel configs: a reference that does not
 * exist in the source is remapped to the same topic under the detected robot namespace when that
 * topic exists. The data source's topics themselves are never modified.
 */

/** Global variable that force-overrides namespace auto-detection. */
export const ROBOT_ID_VARIABLE = "robot_id";

/** First path segments that are never a robot namespace. */
const NAMESPACE_DENYLIST = new Set(["diagnostics", "rosout", "parameter_events", "clock"]);

type BaseTopic = { name: string; schemaName?: string };

const NAMESPACED_TOPIC_REGEX = /^\/([^/]+)\/.+/;

/**
 * A topic reference at the start of a string: the topic-name portion of a plain topic or of a
 * message path ("/odom.twist.twist.linear.x" -> "/odom" + ".twist.twist.linear.x").
 */
const TOPIC_REFERENCE_REGEX = /^(\/[A-Za-z0-9_/-]+)(.*)$/;

/**
 * Whether a first path segment looks like a Peppermint robot ID (all-uppercase alphanumerics with
 * at least one digit, e.g. SD0452000, MV500PCA5011, SD04XPOR2209). Distinguishes another robot's
 * namespace from a functional group like `safety_region` or `move_base_simple`, which must never
 * be re-namespaced.
 */
function looksLikeRobotNamespace(segment: string): boolean {
  return /^[A-Z0-9]{4,}$/.test(segment) && /[0-9]/.test(segment);
}

/**
 * Determine the robot namespace for a set of topics.
 *
 * The `robot_id` global variable wins when set to a non-empty string. Otherwise topics are
 * grouped by their first path segment (ignoring denylisted segments) and the segment with the
 * most topics wins, tie-broken by lexicographic order so multi-robot sources resolve
 * deterministically.
 */
export function detectRobotNamespace(
  topics: Immutable<BaseTopic[]>,
  globalVariables: Immutable<Record<string, VariableValue>>,
): string | undefined {
  const override = globalVariables[ROBOT_ID_VARIABLE];
  if (typeof override === "string" && override.length > 0) {
    return override.startsWith("/") ? override.slice(1) : override;
  }

  const counts = new Map<string, number>();
  for (const topic of topics) {
    const match = NAMESPACED_TOPIC_REGEX.exec(topic.name);
    if (!match) {
      continue;
    }
    const segment = match[1]!;
    if (NAMESPACE_DENYLIST.has(segment)) {
      continue;
    }
    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [segment, count] of counts) {
    if (count > bestCount || (count === bestCount && best != undefined && segment < best)) {
      best = segment;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Rewrite a single topic reference (a topic name or the topic portion of a message path) against
 * the topics available in the data source.
 *
 * Returns the rewritten string, or undefined when no rewrite applies:
 * - the reference already exists in the source (leave it alone), or
 * - no rewrite target could be determined.
 *
 * Handles both directions of adaptation:
 * - generic reference:            "/odom"        -> "/pmt_007/odom" (only when that topic exists)
 * - other robot's reference:      "/SD0452000/odom" -> "/pmt_007/odom"
 *
 * A reference under another robot's namespace (first segment that looks like a robot ID) is
 * re-namespaced even when the current source does not have the topic: the panel then shows the
 * current robot's topic name (no data, rather than another robot's name), and on a live
 * connection it binds the moment the topic starts being published. Functional first segments
 * (`/safety_region/...`, `/move_base_simple/goal`) are only rewritten when the target topic
 * exists, since their first segment is part of the real topic name.
 */
export function rewriteTopicReference(
  value: string,
  topicNames: ReadonlySet<string>,
  namespace: string,
): string | undefined {
  const match = TOPIC_REFERENCE_REGEX.exec(value);
  if (!match) {
    return undefined;
  }
  const topicPart = match[1]!;
  const rest = match[2]!;

  if (topicNames.has(topicPart)) {
    return undefined;
  }

  // Generic reference -> namespaced topic
  const namespaced = `/${namespace}${topicPart}`;
  if (topicNames.has(namespaced)) {
    return namespaced + rest;
  }

  // Reference namespaced under a different robot -> re-namespace
  const secondSlash = topicPart.indexOf("/", 1);
  if (secondSlash > 0) {
    const firstSegment = topicPart.slice(1, secondSlash);
    const renamed = `/${namespace}${topicPart.slice(secondSlash)}`;
    if (renamed !== topicPart) {
      if (topicNames.has(renamed)) {
        return renamed + rest;
      }
      if (looksLikeRobotNamespace(firstSegment)) {
        return renamed + rest;
      }
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

/** Whether a per-topic settings entry is explicitly enabled. */
function isVisible(value: unknown): boolean {
  return isRecord(value) && value.visible === true;
}

/**
 * Recursively rewrite topic references in a panel config: string values that look like topic
 * names or message paths, and object keys that look like topic names (e.g. the 3D panel's
 * per-topic settings map). Returns the original value when nothing changed.
 */
export function rewriteConfigTopics<T>(
  config: T,
  topicNames: ReadonlySet<string>,
  namespace: string,
): { config: T; changed: boolean } {
  if (typeof config === "string") {
    const rewritten = rewriteTopicReference(config, topicNames, namespace);
    return rewritten != undefined
      ? { config: rewritten as T, changed: true }
      : { config, changed: false };
  }

  if (Array.isArray(config)) {
    let changed = false;
    const out: unknown[] = [];
    for (const item of config) {
      const result = rewriteConfigTopics(item, topicNames, namespace);
      changed ||= result.changed;
      out.push(result.config);
    }
    return changed ? { config: out as T, changed } : { config, changed: false };
  }

  if (isRecord(config)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      let newKey = key;
      if (key.startsWith("/")) {
        const rewrittenKey = rewriteTopicReference(key, topicNames, namespace);
        // Never clobber an existing entry for the target topic
        if (rewrittenKey != undefined && !(rewrittenKey in config)) {
          newKey = rewrittenKey;
          changed = true;
        }
      }
      const result = rewriteConfigTopics(value, topicNames, namespace);
      changed ||= result.changed;

      // Layouts accumulate per-topic settings for several robots (e.g. /SD0452000/map and
      // /SD0452027/map), which all rewrite onto the same target key. Prefer the entry that was
      // visible so a topic the user had enabled for any robot stays enabled here; otherwise keep
      // the first, for a deterministic result.
      if (newKey !== key && newKey in out) {
        if (isVisible(out[newKey]) || !isVisible(result.config)) {
          continue;
        }
      }
      out[newKey] = result.config;
    }
    return changed ? { config: out as T, changed } : { config, changed: false };
  }

  return { config, changed: false };
}
