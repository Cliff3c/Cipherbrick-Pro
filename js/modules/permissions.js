// js/modules/permissions.js

function isNative() {
  const C = window.Capacitor;
  if (!C) return false;
  // Capacitor v5+
  if (typeof C.isNativePlatform === 'function') return C.isNativePlatform();
  // Fallback
  const p = typeof C.getPlatform === 'function' ? C.getPlatform() : C.platform;
  return p === 'android' || p === 'ios';
}

export async function ensureCameraPermission() {
  if (isNative() && window.Capacitor?.Permissions?.requestPermissions) {
    try {
      await window.Capacitor.Permissions.requestPermissions({ permissions: ['camera'] });
      return true;
    } catch (e) {
      console.error('Capacitor camera permission failed:', e);
      return false;
    }
  }
  // Web: trigger the browser prompt
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    console.error('Web camera permission failed:', e);
    return false;
  }
}

export async function ensureMicPermission() {
  if (isNative() && window.Capacitor?.Permissions?.requestPermissions) {
    try {
      await window.Capacitor.Permissions.requestPermissions({ permissions: ['microphone'] });
      return true;
    } catch (e) {
      console.error('Capacitor mic permission failed:', e);
      return false;
    }
  }
  // Web: trigger the browser prompt
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    console.error('Web mic permission failed:', e);
    return false;
  }
}
