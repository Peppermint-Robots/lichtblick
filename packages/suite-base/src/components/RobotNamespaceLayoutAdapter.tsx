// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useRef } from "react";

import Logger from "@lichtblick/log";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import {
  PanelStateStore,
  usePanelStateStore,
} from "@lichtblick/suite-base/context/PanelStateContext";
import useGlobalVariables from "@lichtblick/suite-base/hooks/useGlobalVariables";
import {
  detectRobotNamespace,
  rewriteConfigTopics,
} from "@lichtblick/suite-base/util/robotNamespaceLayout";

import { MessagePipelineContext } from "./MessagePipeline/types";

const log = Logger.getLogger(__filename);

const selectTopics = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.topics;
const selectConfigById = (state: LayoutState) => state.selectedLayout?.data?.configById;
const selectLayoutId = (state: LayoutState) => state.selectedLayout?.id;
const selectLayoutLoading = (state: LayoutState) => state.selectedLayout?.loading ?? false;
const selectIncrementSequenceNumber = (store: PanelStateStore) => store.incrementSequenceNumber;

/**
 * Adapts the current layout to the connected robot's topic namespace (`/<robot_id>/<topic>`).
 *
 * Whenever the data source's topics change, panel-config topic references that do not exist in
 * the source are rewritten to the same topic under the detected robot namespace when available.
 * This makes shipped default layouts (generic names like `/map`) and layouts saved against one
 * robot (`/robot_b/map`) work unchanged when connecting to another robot — enabled topics stay
 * enabled. The data source's topics themselves are never modified.
 */
export default function RobotNamespaceLayoutAdapter(): ReactNull {
  const topics = useMessagePipeline(selectTopics);
  const configById = useCurrentLayoutSelector(selectConfigById);
  const layoutId = useCurrentLayoutSelector(selectLayoutId);
  const layoutLoading = useCurrentLayoutSelector(selectLayoutLoading);
  const { savePanelConfigs } = useCurrentLayoutActions();
  const incrementSequenceNumber = usePanelStateStore(selectIncrementSequenceNumber);
  const { globalVariables } = useGlobalVariables();

  // Signature of the last (layout, namespace, topic set) we acted on. The player emits a fresh
  // `topics` array reference on every state update, so without this guard the effect would re-run
  // continuously; and because a config write does not immediately reflect back into `configById`,
  // each of those runs would re-apply the rewrite and re-`incrementSequenceNumber`, remounting the
  // 3D/Image panels in a tight loop until the browser runs out of WebGL contexts.
  const appliedSignatureRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!topics || topics.length === 0 || !configById || layoutLoading) {
      return;
    }

    const namespace = detectRobotNamespace(topics, globalVariables);
    if (namespace == undefined) {
      return;
    }

    const topicNames = new Set(topics.map((topic) => topic.name));

    // Re-process only when the layout, detected namespace, or set of available topics changes —
    // not on every player emit. Keyed on topic count (cheap): switching robots changes the
    // namespace, and topics appearing/disappearing changes the count; either re-triggers a pass.
    const signature = `${layoutId ?? ""}\0${namespace}\0${topicNames.size}`;
    if (signature === appliedSignatureRef.current) {
      return;
    }
    appliedSignatureRef.current = signature;

    const updates = [];
    for (const [panelId, config] of Object.entries(configById)) {
      const result = rewriteConfigTopics(config, topicNames, namespace);
      if (result.changed) {
        updates.push({ id: panelId, config: result.config, override: true });
      }
    }

    if (updates.length > 0) {
      log.info(
        `Rewriting topic references in ${updates.length} panel(s) for robot namespace "${namespace}"`,
      );
      savePanelConfigs({ configs: updates });
      // Panels built on PanelExtensionAdapter (3D, Image) read their config from `initialState`
      // exactly once, so a config write alone would not reach them. Bumping the sequence number
      // remounts the panel against the rewritten config — the same mechanism the settings sidebar
      // uses for "reset to defaults".
      for (const { id } of updates) {
        incrementSequenceNumber(id);
      }
    }
  }, [
    topics,
    configById,
    layoutId,
    layoutLoading,
    globalVariables,
    savePanelConfigs,
    incrementSequenceNumber,
  ]);

  return ReactNull;
}
