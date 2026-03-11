function getDefaultTurnHost() {
  return typeof window !== 'undefined' ? window.location.hostname : 'localhost';
}

export function getIceServers() {
  const host = import.meta.env.VITE_TURN_HOST || getDefaultTurnHost();
  const user = import.meta.env.VITE_TURN_USER || 'reporter';
  const password = import.meta.env.VITE_TURN_PASSWORD || 'reporter123';
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: `stun:${host}:3478` },
    { urls: [`turn:${host}:3478`, `turn:${host}:3478?transport=tcp`], username: user, credential: password },
  ];
}
