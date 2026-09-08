// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  CameraState,
  DEFAULT_CAMERA_STATE,
  isDefaultCameraView,
  makeDefaultCameraState,
} from "./camera";

describe("makeDefaultCameraState", () => {
  it("equals the default", () => {
    expect(makeDefaultCameraState()).toEqual(DEFAULT_CAMERA_STATE);
  });

  it("does not share array references with the shared default", () => {
    // Handing out the shared arrays would let one reset (or immer freezing the result) corrupt
    // every later one.
    const first = makeDefaultCameraState();
    const second = makeDefaultCameraState();
    expect(first.targetOffset).not.toBe(DEFAULT_CAMERA_STATE.targetOffset);
    expect(first.targetOffset).not.toBe(second.targetOffset);
    expect(first.target).not.toBe(DEFAULT_CAMERA_STATE.target);
    expect(first.targetOrientation).not.toBe(DEFAULT_CAMERA_STATE.targetOrientation);
  });

  it("survives being frozen, as immer freezes what it produces", () => {
    const state = makeDefaultCameraState();
    Object.freeze(state.targetOffset);
    expect(() => makeDefaultCameraState()).not.toThrow();
    expect(Object.isFrozen(makeDefaultCameraState().targetOffset)).toBe(false);
  });
});

describe("isDefaultCameraView", () => {
  const moved = (overrides: Partial<CameraState>): CameraState => ({
    ...makeDefaultCameraState(),
    ...overrides,
  });

  it("treats the default as unmoved", () => {
    expect(isDefaultCameraView(makeDefaultCameraState())).toBe(true);
    expect(isDefaultCameraView(DEFAULT_CAMERA_STATE)).toBe(true);
  });

  it("treats a missing state as unmoved, so no button is offered before the camera exists", () => {
    expect(isDefaultCameraView(undefined)).toBe(true);
  });

  it.each([
    ["panned away", { targetOffset: [10.46, 26.25, 0] as const }],
    ["zoomed", { distance: 33.4 }],
    ["tilted", { phi: 41.1 }],
    ["rotated", { thetaOffset: 14.39 }],
    ["retargeted", { target: [5, 0, 0] as const }],
    ["reoriented", { targetOrientation: [0, 0, 1, 0] as const }],
    ["switched to orthographic", { perspective: false }],
  ])("detects a camera that has been %s", (_label, overrides) => {
    expect(isDefaultCameraView(moved(overrides))).toBe(false);
  });

  it.each([
    ["fovy", { fovy: 60 }],
    ["near", { near: 0.01 }],
    ["far", { far: 10_000 }],
  ])("ignores the lens setting %s, which the user may have tuned deliberately", (_l, overrides) => {
    expect(isDefaultCameraView(moved(overrides))).toBe(true);
  });

  it("tolerates floating-point drift rather than showing the button forever", () => {
    expect(isDefaultCameraView(moved({ distance: DEFAULT_CAMERA_STATE.distance + 1e-12 }))).toBe(
      true,
    );
    expect(
      isDefaultCameraView(moved({ targetOffset: [0, 0, -8.35587542267099e-17] as const })),
    ).toBe(true);
  });
});
