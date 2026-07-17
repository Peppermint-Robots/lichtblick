// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * A wrapper around window.showOpenFilePicker that returns an empty array instead of throwing when
 * the user cancels the file picker.
 *
 * The File System Access API is only available in Chromium browsers and secure contexts (https or
 * localhost). When it is unavailable — e.g. the web build served over plain http by a host
 * application, or Firefox/Safari — fall back to a classic `<input type="file">` picker and wrap
 * the picked Files in handle-like objects.
 */
export default async function showOpenFilePicker(
  options?: OpenFilePickerOptions,
): Promise<FileSystemFileHandle[] /* foxglove-depcheck-used: @types/wicg-file-system-access */> {
  if (typeof window.showOpenFilePicker !== "function") {
    return await showOpenFilePickerFallback(options);
  }

  try {
    return await window.showOpenFilePicker(options);
  } catch (err: unknown) {
    if ((err as Error).name === "AbortError") {
      return [];
    }
    throw err;
  }
}

/**
 * Wrap a File picked from an `<input type="file">` element in an object that implements the
 * subset of the FileSystemFileHandle interface the app uses (getFile and the permission methods).
 * Files picked via an input are always readable, so permissions report "granted".
 *
 * Note: unlike real handles these are not structured-cloneable, so they cannot be persisted to
 * IndexedDB "recents" — that save fails softly and is logged.
 */
function fileToHandle(file: File): FileSystemFileHandle {
  const handle: Pick<FileSystemFileHandle, "kind" | "name" | "getFile" | "isSameEntry"> & {
    queryPermission: () => Promise<PermissionState>;
    requestPermission: () => Promise<PermissionState>;
  } = {
    kind: "file",
    name: file.name,
    getFile: async () => file,
    isSameEntry: async () => false,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  };
  return handle as FileSystemFileHandle;
}

async function showOpenFilePickerFallback(
  options?: OpenFilePickerOptions,
): Promise<FileSystemFileHandle[]> {
  const accept = (options?.types ?? [])
    .flatMap((type) => Object.values(type.accept ?? {}).flat())
    .join(",");

  return await new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options?.multiple ?? false;
    if (accept.length > 0) {
      input.accept = accept;
    }
    input.style.display = "none";
    document.body.appendChild(input);

    const finish = (files: File[]) => {
      input.remove();
      resolve(files.map(fileToHandle));
    };
    input.onchange = () => {
      finish([...(input.files ?? [])]);
    };
    input.oncancel = () => {
      finish([]);
    };
    input.click();
  });
}
