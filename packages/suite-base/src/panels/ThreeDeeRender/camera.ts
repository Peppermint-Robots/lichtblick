// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import type { ColorRGBA, Vector3 } from "./ros";
import type { Pose } from "./transforms";

export type BaseShape = {
  pose: Pose;
  scale: Vector3;
  color?: ColorRGBA;
};

export type MouseEventObject = {
  object: BaseShape;
  instanceIndex?: number;
};

export type CameraState = {
  distance: number;
  perspective: boolean;
  phi: number;
  target: readonly [number, number, number];
  targetOffset: readonly [number, number, number];
  targetOrientation: readonly [number, number, number, number];
  thetaOffset: number;
  fovy: number;
  near: number;
  far: number;
};

export const DEFAULT_CAMERA_STATE: CameraState = {
  distance: 20,
  perspective: true,
  phi: 60,
  target: [0, 0, 0],
  targetOffset: [0, 0, 0],
  targetOrientation: [0, 0, 0, 1],
  thetaOffset: 45,
  fovy: 45,
  near: 0.5,
  far: 5000,
};

/**
 * A fresh, independently mutable copy of the default camera state.
 *
 * `DEFAULT_CAMERA_STATE` holds arrays, so handing it out directly would let a caller (or immer,
 * which freezes what it produces) reach the shared default and affect every later reset.
 */
export function makeDefaultCameraState(): CameraState {
  return {
    ...DEFAULT_CAMERA_STATE,
    target: [...DEFAULT_CAMERA_STATE.target],
    targetOffset: [...DEFAULT_CAMERA_STATE.targetOffset],
    targetOrientation: [...DEFAULT_CAMERA_STATE.targetOrientation],
  };
}

/** Floating-point slop, so a camera nudged by rounding still counts as being at the default. */
const CAMERA_EPSILON = 1e-6;

function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < CAMERA_EPSILON;
}

function vectorsEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => numbersEqual(value, b[index] ?? NaN));
}

/**
 * Whether the camera is still at its default vantage point.
 *
 * Only the fields that decide *where the camera is looking* are compared. `fovy`, `near` and `far`
 * are lens settings a user may deliberately tune, and a changed clipping plane should not make the
 * panel claim the view has been moved.
 */
export function isDefaultCameraView(state: CameraState | undefined): boolean {
  if (state == undefined) {
    return true;
  }
  return (
    state.perspective === DEFAULT_CAMERA_STATE.perspective &&
    numbersEqual(state.distance, DEFAULT_CAMERA_STATE.distance) &&
    numbersEqual(state.phi, DEFAULT_CAMERA_STATE.phi) &&
    numbersEqual(state.thetaOffset, DEFAULT_CAMERA_STATE.thetaOffset) &&
    vectorsEqual(state.target, DEFAULT_CAMERA_STATE.target) &&
    vectorsEqual(state.targetOffset, DEFAULT_CAMERA_STATE.targetOffset) &&
    vectorsEqual(state.targetOrientation, DEFAULT_CAMERA_STATE.targetOrientation)
  );
}

export type OrbitControlsConfig = {
  screenSpacePanning: boolean;
  mouseButtons: {
    LEFT: number;
    RIGHT: number;
  };
  touches: {
    ONE: number;
    TWO: number;
  };
  keys: {
    LEFT: string;
    RIGHT: string;
    UP: string;
    BOTTOM: string;
  };
};

export const DEFAULT_ORBIT_CONTROLS_CONFIG: OrbitControlsConfig = {
  screenSpacePanning: false,
  mouseButtons: {
    LEFT: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  },
  touches: {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  },
  keys: { LEFT: "KeyA", RIGHT: "KeyD", UP: "KeyW", BOTTOM: "KeyS" },
};
