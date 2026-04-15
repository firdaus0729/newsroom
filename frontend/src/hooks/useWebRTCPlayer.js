import { useState, useRef, useCallback, useEffect } from 'react';
import { getIceServers } from '../config/iceServers';

// OME application name (must match useWebRTCPublisher and OME config)
const APP = 'live';
const RECONNECT_BASE_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 10;

function buildWsUrl(serverUrl, streamName) {
  let base = (serverUrl || '').trim();
  if (!base) return null;
  // Convert http(s) endpoints into correct ws(s) WebSocket endpoints.
  if (base.startsWith('https://')) base = base.replace(/^https:/, 'wss:');
  else if (base.startsWith('http://')) base = base.replace(/^http:/, 'ws:');
  else if (!base.startsWith('ws://') && !base.startsWith('wss://')) base = `ws://${base}`;
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
      try { pcRef.current.close(); } catch (_) {}
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
        try { pcRef.current.close(); } catch (_) {}
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

      let sessionId = 0;
      const collectedCandidates = [];

      const safeSetState = (s, m) => {
        if (mountedRef.current) {
          setStatus(s);
          setErrorMessage(m || '');
        }
      };

      const scheduleReconnect = () => {
        if (!playParamsRef.current || !autoReconnect || reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) return;
        const delay = RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        if (mountedRef.current) {
          setStatus('connecting');
          setErrorMessage('Reconnecting in ' + Math.round(delay / 1000) + 's…');
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (wsRef.current) try { wsRef.current.close(); } catch (_) {}
          if (pcRef.current) try { pcRef.current.close(); } catch (_) {}
          wsRef.current = null;
          pcRef.current = null;
          const { serverUrl: url, streamName: name } = playParamsRef.current;
          if (url && name) performPlay(url, name);
        }, delay);
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          collectedCandidates.push(e.candidate);
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

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          if (playParamsRef.current && autoReconnect) scheduleReconnect();
        }
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
            sessionId = msg.id != null ? msg.id : 0;
            const fromServerIce = msg.iceServers || msg.ice_servers;
            if (fromServerIce && Array.isArray(fromServerIce)) {
              const iceServers = fromServerIce.map((s) => ({
                urls: s.urls,
                username: s.username || s.user_name,
                credential: s.credential,
              }));
              pc.setConfiguration({ iceServers });
            }
            const sdp = typeof msg.sdp === 'string' ? msg.sdp : msg.sdp?.sdp;
            if (!sdp) {
              safeSetState('error', 'Invalid offer');
              return;
            }
            await pc.setRemoteDescription({ type: 'offer', sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (pc.iceGatheringState !== 'complete') {
              await new Promise((resolve) => {
                const onState = () => {
                  if (pc.iceGatheringState === 'complete') {
                    pc.onicegatheringstatechange = null;
                    resolve();
                  }
                };
                pc.onicegatheringstatechange = onState;
                setTimeout(resolve, 3000);
              });
            }
            ws.send(JSON.stringify({
              command: 'answer',
              sdp: answer,
              id: sessionId,
              candidates: collectedCandidates.map((c) =>
                c.toJSON ? c.toJSON() : { candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex ?? 0 }
              ),
            }));
            if (msg.candidates) {
              for (const c of msg.candidates) {
                try {
                  await pc.addIceCandidate(c);
                } catch (e) {
                  console.warn('player addIceCandidate error', e);
                }
              }
            }
            reconnectAttemptRef.current = 0;
            safeSetState('playing', '');
          } else if (msg.command === 'candidate') {
            if (msg.candidate) {
              try {
                await pc.addIceCandidate(msg.candidate);
              } catch (e) {
                console.warn('player addIceCandidate (trickle) error', e);
              }
            }
          } else if (msg.code && msg.code !== 200) {
            safeSetState('error', msg.message || 'Error ' + msg.code);
          }
        } catch (e) {
          console.error('player signalling error', e);
          safeSetState('error', e?.message || 'Signalling error');
        }
      };

      ws.onerror = () => {
        safeSetState('error', 'WebSocket error');
      };

      ws.onclose = () => {
        if (!mountedRef.current || !playParamsRef.current) return;
        if (autoReconnect && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          scheduleReconnect();
        } else {
          safeSetState('error', 'Connection closed');
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
