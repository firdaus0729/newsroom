/**
 * ICE server configuration for WebRTC (STUN/TURN).
 * Reporters use these for NAT traversal when publishing from mobile networks.
 *
 * Env (optional):
 *   VITE_TURN_HOST     - TURN/STUN host (e.g. your server or coturn host). Default: same as OME host.
 *   VITE_TURN_USER     - TURN username (Coturn static user). Default: reporter
 *   VITE_TURN_PASSWORD - TURN credential. Default: reporter123 (match coturn/turnserver.conf)
 */

function getDefaultTurnHost() {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  return host || 'localhost';
}

export function getIceServers() {
  const host = import.meta.env.VITE_TURN_HOST || getDefaultTurnHost();
  const user = import.meta.env.VITE_TURN_USER || 'reporter';
  const password = import.meta.env.VITE_TURN_PASSWORD || 'reporter123';

  const servers = [
    { urls: `stun:${host}:3478` },
    {
      urls: [`turn:${host}:3478`, `turn:${host}:3478?transport=tcp`],
      username: user,
      credential: password,
    },
  ];

  // Fallback to Google STUN if no custom TURN host (e.g. local dev)
  if (!import.meta.env.VITE_TURN_HOST) {
    servers.unshift({ urls: 'stun:stun.l.google.com:19302' });
  }

  return servers;
}
