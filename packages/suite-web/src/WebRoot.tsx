// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";

import {
  AppBarProps,
  AppSetting,
  IExtensionLoader,
  FoxgloveWebSocketDataSourceFactory,
  IDataSourceFactory,
  IdbExtensionLoader,
  McapLocalDataSourceFactory,
  RemoteDataSourceFactory,
  RemoteExtensionLoader,
  Ros1LocalBagDataSourceFactory,
  Ros2LocalBagDataSourceFactory,
  RosbridgeDataSourceFactory,
  SampleNuscenesDataSourceFactory,
  SharedRoot,
  UlogLocalDataSourceFactory,
} from "@lichtblick/suite-base";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import { AppParametersInput } from "@lichtblick/suite-base/context/AppParametersContext";
import { bundledLayouts } from "@lichtblick/suite-base/layouts";
import { BundledLayoutLoader } from "@lichtblick/suite-base/services/BundledLayoutLoader";

import LocalStorageAppConfiguration from "./services/LocalStorageAppConfiguration";

const isDevelopment = process.env.NODE_ENV === "development";

/**
 * Custom extensions installed automatically on startup
 * To add one: put the .foxe in packages/suite-web/public/extensions/
 * and add an entry here. Bump version to push an update
 */
const bundled_extensions = [
  {
    id: "peppermint.rosbag-analyzer",
    version: "1.0.0",
    url: "/extensions/peppermint.rosbag-analyzer-1.0.0.foxe",
  },

  {
    id: "Cloudini.foxglove-cloudini-converter",
    version: "1.2.0",
    url: "/extensions/cloudini.foxglove-cloudini-converter-1.2.0.foxe",
  },

  {
    id: "peppermint.amcl-particle-cloud",
    version: "0.2.0",
    url: "/extensions/peppermint.amcl-particle-cloud-0.2.0.foxe",
  },
];

export function WebRoot(props: {
  extraProviders: React.JSX.Element[] | undefined;
  dataSources: IDataSourceFactory[] | undefined;
  AppBarComponent?: (props: AppBarProps) => React.JSX.Element;
  children: React.JSX.Element;
}): React.JSX.Element {
  const appConfiguration = useMemo(
    () =>
      new LocalStorageAppConfiguration({
        defaults: {
          [AppSetting.SHOW_DEBUG_PANELS]: isDevelopment,
        },
      }),
    [],
  );

  const [localLoader] = useState(() => new IdbExtensionLoader("local"));
  // this is for bundled extensions
  // install them into same loader the app will read from
  const defaultExtensionLoaders: IExtensionLoader[] = [
    new IdbExtensionLoader("org"),
    localLoader,
  ];
  const url = new URL(globalThis.location.href);
  const workspace = url.searchParams.get("workspace");

  if (workspace && APP_CONFIG.apiUrl) {
    defaultExtensionLoaders.push(new RemoteExtensionLoader("org", workspace));
  }
  const [extensionLoaders] = useState(() => defaultExtensionLoaders);

  const layout = url.searchParams.get("layout");
  const [appParameters] = useState<AppParametersInput>(() => {
    const params: Record<string, string> = {};
    if (layout != undefined && layout !== "") {
      params.defaultLayout = layout;
    }
    return params;
  });

  const layoutsUrl = url.searchParams.get("layoutsUrl");
  const [layoutLoaders] = useState(() => [
    new BundledLayoutLoader(bundledLayouts, layoutsUrl ?? undefined),
  ]);

  const dataSources = useMemo(() => {
    const sources = [
      new Ros1LocalBagDataSourceFactory(),
      new Ros2LocalBagDataSourceFactory(),
      new FoxgloveWebSocketDataSourceFactory(),
      new RosbridgeDataSourceFactory(),
      new UlogLocalDataSourceFactory(),
      new SampleNuscenesDataSourceFactory(),
      new McapLocalDataSourceFactory(),
      new RemoteDataSourceFactory(),
    ];

    return props.dataSources ?? sources;
  }, [props.dataSources]);

  const [extensionsReady, setExtensionsReady] = useState(false);

  // install bundled ext once and if fails then wont block other things
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      for (const { id, version, url: foxeUrl } of bundled_extensions) {
        if (cancelled) {
          return;
        }
        try {
          const existing = await localLoader.getExtension(id);
          if (existing?.version === version) {
            continue; // already installed and same version
          }

          const response = await fetch(foxeUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          await localLoader.installExtension({
            foxeFileData: new Uint8Array(await response.arrayBuffer()),
          });
        } catch (error) {
          console.error(`Failed to install bundled extension ${id}:`, error);
        }
      }

      if (!cancelled) {
        setExtensionsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [localLoader]);

  if (!extensionsReady) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        Loading extensions...
      </div>
    );
  }

  return (
    <SharedRoot
      enableLaunchPreferenceScreen
      deepLinks={[globalThis.location.href]}
      dataSources={dataSources}
      appConfiguration={appConfiguration}
      appParameters={appParameters}
      extensionLoaders={extensionLoaders}
      layoutLoaders={layoutLoaders}
      enableGlobalCss
      extraProviders={props.extraProviders}
      AppBarComponent={props.AppBarComponent}
    >
      {props.children}
    </SharedRoot>
  );
}
