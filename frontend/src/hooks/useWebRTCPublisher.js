import { useState, useRef, useCallback, useEffect } from 'react';
import { getIceServers } from '../config/iceServers';
import { BITRATE_PRESETS } from '../constants/bitrate';

// OME default application name is 'app' in the stock Server.xml
const APP = 'app';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1000;
const STATS_INTERVAL_MS = 2000;


function buildWsUrl(serverUrl, streamName) {
  let base = (serverUrl || '').trim();
  if (!base) return null;
  base = base.replace(/^http/, 'ws');
  if (!base.includes('://')) base = 'ws://' + base;
  base = base.replace(/\/+$/, '');
  return `${base}/${APP}/${encodeURIComponent(streamName)}?direction=send`;
}

function applyBitrateToSender(sender, bitrateKey) {
  const preset = BITRATE_PRESETS[bitrateKey] || BITRATE_PRESETS.medium;
  const maxBitrate = preset.value;
  try {
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    params.encodings.forEach((enc) => {
      enc.maxBitrate = maxBitrate;
    });
    sender.setParameters(params).catch(() => {});
  } catch (_) {}
}

export function useWebRTCPublisher() {
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [previewStream, setPreviewStream] = useState(null);
  const [networkQuality, setNetworkQuality] = useState(null);
  const [liveDurationSeconds, setLiveDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const mediaStreamRef = useRef(null);
  const currentFacingRef = useRef('environment');
  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const liveStartedAtRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const statsIntervalRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const lastConnectParamsRef = useRef(null);

  const stopPreview = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setPreviewStream(null);
  }, []);

  const closeConnection = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (_) {}
      wsRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch (_) {}
      pcRef.current = null;
    }
    setNetworkQuality(null);
    liveStartedAtRef.current = null;
    setLiveDurationSeconds(0);
  }, []);

  const startPreview = useCallback(
    async (videoDeviceId, audioDeviceId) => {
      stopPreview();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined,
            facingMode: currentFacingRef.current,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
        });
        mediaStreamRef.current = stream;
        setPreviewStream(stream);
        setStatus('idle');
        setErrorMessage('');
        setIsMuted(false);
        return stream;
      } catch (e) {
        setStatus('error');
        setErrorMessage('Camera/mic access failed: ' + (e.message || 'Unknown'));
        throw e;
      }
    },
    [stopPreview]
  );

  const performConnect = useCallback(
    async (params) => {
      const { serverUrl, streamName, videoDeviceId, audioDeviceId, bitrate = 'medium', onLive } = params || {};
      const wsUrl = buildWsUrl(serverUrl, streamName);
      if (!wsUrl) {
        setStatus('error');
        setErrorMessage('Invalid server URL or stream name');
        return;
      }

      let stream = mediaStreamRef.current;
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined,
              facingMode: currentFacingRef.current,
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
          });
          mediaStreamRef.current = stream;
          setPreviewStream(stream);
        } catch (e) {
          setStatus('error');
          setErrorMessage('Camera/mic failed: ' + (e.message || 'Unknown'));
          return;
        }
      }

      const pc = new RTCPeerConnection({
        iceServers: getIceServers(),
      });
      const ws = new WebSocket(wsUrl);
      pcRef.current = pc;
      wsRef.current = ws;

      // OME requires the same id as the offer in answer and all candidate messages
      let sessionId = 0;
      // Collect candidates so we can send them in the answer (OME expects "candidate list" in answer)
      const collectedCandidates = [];
      let answerSent = false;

      const safeSetStatus = (s, msg = '') => {
        setStatus(s);
        setErrorMessage(msg);
      };

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        collectedCandidates.push(e.candidate);
        if (answerSent && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ command: 'candidate', candidate: e.candidate, id: sessionId }));
        }
      };

      const scheduleReconnect = () => {
        if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setStatus('error');
          setErrorMessage('Reconnection failed after ' + MAX_RECONNECT_ATTEMPTS + ' attempts');
          reconnectAttemptRef.current = 0;
          return;
        }
        const delay = RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        setStatus('reconnecting');
        setErrorMessage('Reconnecting in ' + Math.round(delay / 1000) + 's (attempt ' + reconnectAttemptRef.current + ')');
        reconnectTimeoutRef.current = setTimeout(() => {
          if (wsRef.current) try { wsRef.current.close(); } catch (_) {}
          if (pcRef.current) try { pcRef.current.close(); } catch (_) {}
          wsRef.current = null;
          pcRef.current = null;
          if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          setNetworkQuality(null);
          performConnect(lastConnectParamsRef.current);
        }, delay);
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          if (lastConnectParamsRef.current) {
            scheduleReconnect();
          }
        }
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      ws.onopen = () => {
        safeSetStatus('connecting', 'Requesting offer…');
        // Follow the same signalling pattern as the WebRTC player:
        // ask OME for an offer, then respond with an answer.
        ws.send(JSON.stringify({ command: 'request_offer', id: 0 }));
      };

      ws.onmessage = async (ev) => {
        console.log('publisher signalling', ev.data);
        try {
          const msg = JSON.parse(ev.data);
          if (msg.command === 'offer') {
            sessionId = msg.id != null ? msg.id : 0;
            // Prefer iceServers camelCase if present, fallback to ice_servers
            const fromServerIce = msg.iceServers || msg.ice_servers;
            if (fromServerIce && Array.isArray(fromServerIce)) {
              // Map to proper RTCIceServer shape (username vs user_name)
              const iceServers = fromServerIce.map((s) => ({
                urls: s.urls,
                username: s.username || s.user_name,
                credential: s.credential,
              }));
              pc.setConfiguration({ iceServers });
            }
            const sdp = typeof msg.sdp === 'string' ? msg.sdp : msg.sdp?.sdp;
            if (!sdp) {
              safeSetStatus('error', 'Invalid offer');
              return;
            }
            await pc.setRemoteDescription({ type: 'offer', sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            // OME expects candidates in the answer; wait for ICE gathering to complete
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
              command: 'offer',
              sdp: answer,
              id: sessionId,
              candidates: collectedCandidates.map((c) => (c.toJSON ? c.toJSON() : { candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex ?? 0 })),
            }));
            answerSent = true;
            if (msg.candidates) {
              for (const c of msg.candidates) {
                try {
                  await pc.addIceCandidate(c);
                } catch (e) {
                  console.warn('publisher addIceCandidate error', e);
                }
              }
            }
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) applyBitrateToSender(sender, bitrate);
            reconnectAttemptRef.current = 0;
            safeSetStatus('live', '');
            liveStartedAtRef.current = Date.now();
            if (typeof onLive === 'function') onLive();
          } else if (msg.command === 'candidate') {
            if (msg.candidate) {
              try {
                await pc.addIceCandidate(msg.candidate);
              } catch (e) {
                console.warn('publisher addIceCandidate (trickle) error', e);
              }
            }
          } else if (msg.code && msg.code !== 200) {
            safeSetStatus('error', msg.message || 'Server error ' + msg.code);
            closeConnection();
          }
        } catch (e) {
          console.error('publisher signalling error', e);
          safeSetStatus('error', e?.message || 'Signalling error');
        }
      };

      ws.onerror = () => {
        safeSetStatus('error', 'WebSocket error');
      };
      ws.onclose = () => {
        if (lastConnectParamsRef.current && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          scheduleReconnect();
        } else {
          setStatus((s) => (s === 'live' || s === 'reconnecting' ? 'error' : s));
          setErrorMessage((m) => m || 'Connection closed');
        }
      };
    },
    [closeConnection]
  );

  const goLive = useCallback(
    (serverUrl, streamName, options = {}) => {
      const { videoDeviceId, audioDeviceId, bitrate = 'medium', onLive } = options;
      lastConnectParamsRef.current = { serverUrl, streamName, videoDeviceId, audioDeviceId, bitrate, onLive };
      setStatus('connecting');
      setErrorMessage('');
      reconnectAttemptRef.current = 0;
      performConnect(lastConnectParamsRef.current);
    },
    [performConnect]
  );

  const stopStream = useCallback(() => {
    reconnectAttemptRef.current = MAX_RECONNECT_ATTEMPTS;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    closeConnection();
    setStatus('idle');
    setErrorMessage('');
  }, [closeConnection]);

  const toggleMute = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted(!audioTracks[0]?.enabled);
  }, []);

  const switchCamera = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return;
    }
    const nextFacing = currentFacingRef.current === 'user' ? 'environment' : 'user';
    const pc = pcRef.current;
    const wasLive = status === 'live';
    try {
      const videoOnly = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: nextFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });
      currentFacingRef.current = nextFacing;
      const oldStream = mediaStreamRef.current;
      const oldVideo = oldStream?.getVideoTracks()[0];
      if (oldVideo) oldVideo.stop();
      const combined = new MediaStream();
      videoOnly.getVideoTracks().forEach((t) => combined.addTrack(t));
      (oldStream?.getAudioTracks() || []).forEach((t) => combined.addTrack(t));
      if (combined.getAudioTracks().length === 0 && videoOnly.getAudioTracks().length) {
        combined.addTrack(videoOnly.getAudioTracks()[0]);
      }
      mediaStreamRef.current = combined;
      setPreviewStream(combined);
      if (pc && wasLive) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(combined.getVideoTracks()[0]);
      }
    } catch (e) {
      setErrorMessage('Camera switch failed: ' + (e.message || 'Unknown'));
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'live') return;
    const interval = setInterval(() => {
      if (liveStartedAtRef.current) {
        setLiveDurationSeconds(Math.floor((Date.now() - liveStartedAtRef.current) / 1000));
      }
    }, 1000);
    timerIntervalRef.current = interval;
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [status]);

  useEffect(() => {
    if (status !== 'live' || !pcRef.current) return;
    const interval = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        let rtt = null;
        let packetsLost = null;
        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime;
          }
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            packetsLost = report.packetsLost;
          }
        });
        if (rtt != null && rtt < 0.5 && (packetsLost == null || packetsLost < 10)) {
          setNetworkQuality('good');
        } else if (rtt != null && rtt < 1 && (packetsLost == null || packetsLost < 50)) {
          setNetworkQuality('fair');
        } else {
          setNetworkQuality('poor');
        }
      } catch (_) {
        setNetworkQuality(null);
      }
    }, STATS_INTERVAL_MS);
    statsIntervalRef.current = interval;
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, [status]);

  useEffect(() => {
    const audioTracks = mediaStreamRef.current?.getAudioTracks();
    setIsMuted(audioTracks?.length ? !audioTracks[0].enabled : false);
  }, [previewStream]);

  return {
    status,
    errorMessage,
    previewStream,
    networkQuality,
    liveDurationSeconds,
    isMuted,
    startPreview,
    stopPreview,
    goLive,
    stopStream,
    toggleMute,
    switchCamera,
  };
}
