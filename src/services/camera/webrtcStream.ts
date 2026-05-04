export interface WhepConnectionOptions {
  url: string;
  iceServersText: string;
  onConnected?: () => void;
}

export function parseIceServers(value: string): RTCIceServer[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as RTCIceServer | RTCIceServer[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ urls: line }));
  }
}

function waitForIceGathering(peer: RTCPeerConnection, timeoutMs = 1200): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, timeoutMs);
    function done() {
      window.clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }
    function onChange() {
      if (peer.iceGatheringState === 'complete') done();
    }
    peer.addEventListener('icegatheringstatechange', onChange);
  });
}

export async function connectWhepVideoStream(video: HTMLVideoElement, options: WhepConnectionOptions): Promise<() => void> {
  if (!('RTCPeerConnection' in window)) throw new Error('WebRTC is not available in this browser.');
  const peer = new RTCPeerConnection({ iceServers: parseIceServers(options.iceServersText) });
  const media = new MediaStream();
  let resourceUrl = '';

  peer.addTransceiver('video', { direction: 'recvonly' });
  peer.addTransceiver('audio', { direction: 'recvonly' });
  peer.ontrack = (event) => {
    event.streams[0]?.getTracks().forEach((track) => media.addTrack(track));
    if (!video.srcObject) video.srcObject = media;
    options.onConnected?.();
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await waitForIceGathering(peer);

  const response = await fetch(options.url, {
    method: 'POST',
    headers: { 'content-type': 'application/sdp', accept: 'application/sdp' },
    body: peer.localDescription?.sdp ?? offer.sdp,
  });
  if (!response.ok) {
    peer.close();
    throw new Error(`WebRTC offer failed with HTTP ${response.status}.`);
  }
  resourceUrl = response.headers.get('location') ?? '';
  const answer = await response.text();
  await peer.setRemoteDescription({ type: 'answer', sdp: answer });

  return () => {
    const tracks = video.srcObject instanceof MediaStream ? video.srcObject.getTracks() : [];
    tracks.forEach((track) => track.stop());
    video.srcObject = null;
    peer.close();
    if (resourceUrl) {
      void fetch(new URL(resourceUrl, options.url).toString(), { method: 'DELETE' }).catch(() => undefined);
    }
  };
}
