/**
 * Base provider interface for visa appointment systems.
 * Each provider (AIS, VFS Global, etc.) implements these methods.
 */

export const PROVIDER_NAMES = Object.freeze({
  AIS: 'ais',
  VFSGLOBAL: 'vfsglobal',
});
