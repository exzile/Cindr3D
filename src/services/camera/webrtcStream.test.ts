import { describe, expect, it } from 'vitest';
import { parseIceServers } from './webrtcStream';

describe('WebRTC camera stream helpers', () => {
  it('parses newline ICE server entries', () => {
    expect(parseIceServers('stun:stun.example.test:3478\nturn:turn.example.test:3478')).toEqual([
      { urls: 'stun:stun.example.test:3478' },
      { urls: 'turn:turn.example.test:3478' },
    ]);
  });

  it('parses JSON ICE server config', () => {
    expect(parseIceServers('[{"urls":"turn:turn.example.test","username":"u","credential":"p"}]')).toEqual([
      { urls: 'turn:turn.example.test', username: 'u', credential: 'p' },
    ]);
  });
});
