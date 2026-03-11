import { useState, useRef, useCallback, useEffect } from 'react';
import { getIceServers } from '../config/iceServers';

const APP = 'live';
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

function buildWsUrl(serverUrl, streamName) {
  let base = (serverUrl || '').trim();
  if (!base) return null;
  base = base.replace(/^http/, 'ws');
  if (!base.includes('://')) base = 'ws://' + base;
  base = base.replace(/\/+$/, '');
  return `${base}/${APP}/${encodeURIComponent(streamName)}`;
}

export function useWebRTCPlayer(videoRef, options = {}) {
  const { autoReconnect = true } = options;
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const mountedRef = useRef(true);
  const playParamsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptRef = useRef(0);

  const stop = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptRef.current = MAX_RECONNECT_ATTEMPTS;
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
      } catch (_) {}
      wsRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef?.current) {
      videoRef.current.srcObject = null;
    }
    if (mountedRef.current) {
      setStatus('idle');
      setErrorMessage('');
      setAudioBlocked(false);
    }
    playParamsRef.current = null;
  }, [videoRef]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, []);

  const performPlay = useCallback(
    (serverUrl, streamName) => {
      const wsUrl = buildWsUrl(serverUrl, streamName);
      if (!wsUrl) {
        setStatus('error');
        setErrorMessage('Invalid server URL or stream name');
        return;
      }

      if (wsRef.current || pcRef.current) {
        try {
          if (wsRef.current) wsRef.current.close();
          if (pcRef.current) pcRef.current.close();
        } catch (_) {}
        wsRef.current = null;
        pcRef.current = null;
      }

      if (mountedRef.current) {
        setStatus('connecting');
        setErrorMessage('');
      }

      const pc = new RTCPeerConnection({
        iceServers: getIceServers(),
      });
      const ws = new WebSocket(wsUrl);
      pcRef.current = pc;
      wsRef.current = ws;

      const safeSetState = (s, m) => {
        if (mountedRef.current) {
          setStatus(s);
          setErrorMessage(m || '');
        }
      };

      pc.ontrack = (e) => {
        if (!mountedRef.current || !videoRef?.current || !e.streams?.[0]) return;
        const v = videoRef.current;
        v.srcObject = e.streams[0];
        v.playsInline = true;
        v.muted = false;
        const p = v.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            if (mountedRef.current) setAudioBlocked(true);
          });
        }
        safeSetState('playing', '');
      };

      ws.onopen = () => {
        if (!mountedRef.current) return;
        safeSetState('connecting', 'Requesting offer…');
        ws.send(JSON.stringify({ command: 'request_offer', id: 0 }));
      };

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.command === 'offer') {
            if (msg.ice_servers) {
              pc.setConfiguration({ iceServers: msg.ice_servers });
            }
            const sdp = typeof msg.sdp === 'string' ? msg.sdp : msg.sdp?.sdp;
            if (!sdp) {
              safeSetState('error', 'Invalid offer');
              return;
            }
            await pc.setRemoteDescription({ type: 'offer', sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ command: 'answer', sdp: answer, id: msg.id || 0 }));
            if (msg.candidates) {
              for (const c of msg.candidates) {
                try { await pc.addIceCandidate(c); } catch (_) {}
              }
            }
            safeSetState('playing', '');
            reconnectAttemptRef.current = 0;
          } else if (msg.command === 'candidate') {
            if (msg.candidate) {
              try { await pc.addIceCandidate(msg.candidate); } catch (_) {}
            }
          } else if (msg.code && msg.code !== 200) {
            safeSetState('error', msg.message || 'Error ' + msg.code);
          }
        } catch (_) {}
      };

      pc.onicecandidate = (e) => {
        if (e.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ command: 'candidate', candidate: e.candidate, id: 0 }));
        }
      };

      ws.onerror = () => {
        safeSetState('error', 'WebSocket error');
      };

      ws.onclose = () => {
        if (!mountedRef.current || !playParamsRef.current) return;
        safeSetState('error', 'Connection closed');
        if (autoReconnect && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptRef.current += 1;
          const delay = RECONNECT_DELAY_MS;
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (wsRef.current) try { wsRef.current.close(); } catch (_) {}
            if (pcRef.current) try { pcRef.current.close(); } catch (_) {}
            wsRef.current = null;
            pcRef.current = null;
            const { serverUrl, streamName } = playParamsRef.current;
            if (serverUrl && streamName) performPlay(serverUrl, streamName);
          }, delay);
        }
      };
    },
    [autoReconnect, videoRef]
  );

  const play = useCallback(
    (serverUrl, streamName) => {
      playParamsRef.current = { serverUrl, streamName };
      reconnectAttemptRef.current = 0;
      performPlay(serverUrl, streamName);
    },
    [performPlay]
  );

  const tryUnmute = useCallback(() => {
    if (videoRef?.current) {
      videoRef.current.muted = false;
      videoRef.current.play().then(() => setAudioBlocked(false)).catch(() => {});
    }
  }, [videoRef]);

  return { status, errorMessage, audioBlocked, play, stop, tryUnmute };
}
