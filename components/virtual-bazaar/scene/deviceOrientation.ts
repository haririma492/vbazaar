import * as THREE from "three";

/**
 * THE PHONE'S ORIENTATION AS A CAMERA ROTATION (Device Orientation API).
 *
 * The same arithmetic as Three.js's retired `DeviceOrientationControls`:
 * alpha / beta / gamma are the phone's turn about its Z, X and Y axes; the
 * camera looks out of the BACK of the phone, so the result is turned a
 * quarter about X; and a phone held sideways turns the picture with the
 * screen, so the screen's own angle is taken off about Z.
 */

const Z = new THREE.Vector3(0, 0, 1);
/** −90° about X: from "looking at the screen" to "looking out of the back". */
const BACK_OF_PHONE = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const euler = new THREE.Euler();
const screenTurn = new THREE.Quaternion();
const deg = THREE.MathUtils.degToRad;

export function deviceQuaternion(
  out: THREE.Quaternion,
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenDeg: number,
): THREE.Quaternion {
  euler.set(deg(betaDeg), deg(alphaDeg), -deg(gammaDeg), "YXZ");
  out.setFromEuler(euler);
  out.multiply(BACK_OF_PHONE);
  out.multiply(screenTurn.setFromAxisAngle(Z, -deg(screenDeg)));
  return out;
}

/** The compass part of a rotation: its turn about the vertical. */
export function headingOf(q: THREE.Quaternion): number {
  return new THREE.Euler().setFromQuaternion(q, "YXZ").y;
}

/** 0 upright, 90 / −90 / 270 on its side — however this browser says it. */
export function screenAngle(): number {
  if (typeof window === "undefined") return 0;
  const angle = window.screen?.orientation?.angle;
  if (typeof angle === "number") return angle;
  // Older iOS Safari only has the deprecated `window.orientation`.
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

type PermissionFn = () => Promise<"granted" | "denied">;

/** Whether this browser has the API at all (it says nothing about a sensor). */
export function hasDeviceOrientation(): boolean {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

/**
 * ⚠️ iOS ASKS FIRST, AND ONLY INSIDE A TAP. Safari 13+ hides the sensor until
 * `DeviceOrientationEvent.requestPermission()` is granted, and refuses the
 * request unless it runs in the handler of the tap itself — so the page calls
 * this directly from its button, before any other await. Android and desktop
 * have no such function and are simply "granted".
 */
export async function requestDeviceOrientation(): Promise<boolean> {
  const request = (window.DeviceOrientationEvent as unknown as { requestPermission?: PermissionFn })
    ?.requestPermission;
  if (typeof request !== "function") return true;
  try {
    return (await request()) === "granted";
  } catch {
    return false;
  }
}
