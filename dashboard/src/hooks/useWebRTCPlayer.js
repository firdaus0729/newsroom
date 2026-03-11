import { useState, useRef, useCallback } from 'react';
import { getIceServers } from '../config/iceServers';

const APP = 'live';

function buildWsUrl(serverUrl, streamName) {
  let base = (serverUrl || '').trim().replace(/^http/, 'ws');
  if (!base.includes('://')) base = 'ws://' + base;
  base = base.replace(/\/+$/, '');
  return `${base}/${APP}/${encodeURIComponent(streamName)}`;
}

export function useWebRTCPlayer(videoRef) {
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const pcRef = useRef(null);
  const wsRef = useRef(null);

  const stop = useCallback(() => {
    try {
      if (wsRef.current) wsRef.current.close();
      if (pcRef.current) pcRef.current.close();
    } catch (_) {}
    wsRef.current = null;
    pcRef.current = null;
    if (videoRef?.current) videoRef.current.srcObject = null;
    setStatus('idle');
    setErrorMessage('');
  }, [videoRef]);

  const play = useCallback(
    (serverUrl, streamName) => {
      const wsUrl = buildWsUrl(serverUrl, streamName);
      if (!wsUrl) {
        setStatus('error');
        setErrorMessage('Invalid URL');
        return;
      }
      stop();
      setStatus('connecting');
      setErrorMessage('');
      const pc = new RTCPeerConnection({ iceServers: getIceServers() });
      const ws = new WebSocket(wsUrl);
      pcRef.current = pc;
      wsRef.current = ws;

      pc.ontrack = (e) => {
        if (videoRef?.current && e.streams?.[0]) {
          videoRef.current.srcObject = e.streams[0];
          videoRef.current.play().catch(() => {});
          setStatus('playing');
        }
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({ command: 'request_offer', id: 0 }));
      };

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.command === 'offer') {
            if (msg.ice_servers) pc.setConfiguration({ iceServers: msg.ice_servers });
            const sdp = typeof msg.sdp === 'string' ? msg.sdp : msg.sdp?.sdp;
            if (!sdp) { setStatus('error'); setErrorMessage('Invalid offer'); return; }
            await pc.setRemoteDescription({ type: 'offer', sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ command: 'answer', sdp: answer, id: msg.id || 0 }));
            if (msg.candidates) for (const c of msg.candidates) try { await pc.addIceCandidate(c); } catch (_) {}
            setStatus('playing');
          } else if (msg.command === 'candidate' && msg.candidate) {
            try { await pc.addIceCandidate(msg.candidate); } catch (_) {}
          } else if (msg.code && msg.code !== 200) {
            setStatus('error');
            setErrorMessage(msg.message || 'Error');
          }
        } catch (_) {}
      };

      pc.onicecandidate = (e) => {
        if (e.candidate && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ command: 'candidate', candidate: e.candidate, id: 0 }));
      };

      ws.onerror = () => { setStatus('error'); setErrorMessage('WebSocket error'); };
      ws.onclose = () => { setStatus('error'); setErrorMessage('Connection closed'); };
    },
    [stop, videoRef]
  );

  return { status, errorMessage, play, stop };
}
