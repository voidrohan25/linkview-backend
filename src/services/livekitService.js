import crypto from 'crypto';
import { config } from '../config/env.js';

/**
 * Service for LiveKit WebRTC Video Classes
 * Provides token creation when credentials exist, and fallback status when unconfigured.
 */
export class LiveKitService {
  constructor() {
    this.serverUrl = config.livekit.serverUrl;
    this.apiKey = config.livekit.apiKey;
    this.apiSecret = config.livekit.apiSecret;
  }

  isConfigured() {
    return Boolean(this.serverUrl && this.apiKey && this.apiSecret);
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      serverUrl: this.isConfigured() ? this.serverUrl : null,
      provider: this.isConfigured() ? 'livekit' : 'external_fallback',
      message: this.isConfigured()
        ? 'LiveKit WebRTC service is configured and ready.'
        : 'LiveKit server credentials are unconfigured. External meeting links (Zoom/Meet/Teams) are used as fallback.'
    };
  }

  /**
   * Generate LiveKit Access Token
   * Follows LiveKit JWT grant specification:
   * header: { alg: "HS256", typ: "JWT" }
   * claims: { iss: apiKey, sub: identity, video: { room, roomJoin: true, ... } }
   */
  generateToken({ roomName, participantIdentity, participantName, isPublisher = false }) {
    if (!this.isConfigured()) {
      return {
        success: false,
        configured: false,
        error: 'LIVEKIT_NOT_CONFIGURED',
        message: 'LiveKit credentials are not configured on this server. Please use external meeting fallback.'
      };
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const ttl = 6 * 3600; // 6 hours

      const header = {
        alg: 'HS256',
        typ: 'JWT'
      };

      const payload = {
        iss: this.apiKey,
        sub: participantIdentity,
        name: participantName,
        iat: now,
        nbf: now,
        exp: now + ttl,
        video: {
          room: roomName,
          roomJoin: true,
          canPublish: Boolean(isPublisher),
          canSubscribe: true,
          canPublishData: true
        }
      };

      const base64UrlEncode = (obj) => {
        return Buffer.from(JSON.stringify(obj))
          .toString('base64')
          .replace(/=/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');
      };

      const encodedHeader = base64UrlEncode(header);
      const encodedPayload = base64UrlEncode(payload);
      const signatureInput = `${encodedHeader}.${encodedPayload}`;

      const hmac = crypto.createHmac('sha256', this.apiSecret);
      hmac.update(signatureInput);
      const signature = hmac.digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const jwtToken = `${signatureInput}.${signature}`;

      return {
        success: true,
        configured: true,
        token: jwtToken,
        serverUrl: this.serverUrl,
        roomName,
        participantIdentity
      };
    } catch (err) {
      console.error('[LiveKitService] Token generation failed:', err.message);
      return {
        success: false,
        configured: true,
        error: 'TOKEN_GENERATION_FAILED',
        message: err.message
      };
    }
  }

  /**
   * Generate LiveKit Administrative JWT for server-to-server operations
   */
  generateAdminToken(grants = { roomAdmin: true, roomCreate: true, roomList: true }) {
    if (!this.isConfigured()) return null;
    try {
      const now = Math.floor(Date.now() / 1000);
      const ttl = 600; // 10 minutes
      const header = { alg: 'HS256', typ: 'JWT' };
      const payload = {
        iss: this.apiKey,
        sub: 'linktest-backend-admin',
        iat: now,
        nbf: now,
        exp: now + ttl,
        video: grants
      };

      const base64UrlEncode = (obj) =>
        Buffer.from(JSON.stringify(obj))
          .toString('base64')
          .replace(/=/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');

      const encodedHeader = base64UrlEncode(header);
      const encodedPayload = base64UrlEncode(payload);
      const signatureInput = `${encodedHeader}.${encodedPayload}`;
      const hmac = crypto.createHmac('sha256', this.apiSecret);
      hmac.update(signatureInput);
      const signature = hmac.digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      return `${signatureInput}.${signature}`;
    } catch (err) {
      console.error('[LiveKitService] Admin token error:', err.message);
      return null;
    }
  }

  /**
   * Send a Twirp request to LiveKit server
   */
  async _callTwirp(serviceMethod, bodyObj) {
    if (!this.isConfigured()) return { success: false, reason: 'unconfigured' };
    const adminToken = this.generateAdminToken();
    if (!adminToken) return { success: false, reason: 'token_failed' };

    const httpUrl = this.serverUrl
      .replace(/^wss:\/\//i, 'https://')
      .replace(/^ws:\/\//i, 'http://')
      .replace(/\/$/, '');
    const endpoint = `${httpUrl}/twirp/livekit.RoomService/${serviceMethod}`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyObj)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`[LiveKitService] Twirp ${serviceMethod} status ${res.status}:`, text);
        return { success: false, status: res.status, error: text };
      }
      const data = await res.json().catch(() => ({}));
      return { success: true, data };
    } catch (err) {
      console.warn(`[LiveKitService] Twirp ${serviceMethod} network error:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Forcibly close and delete a LiveKit room, disconnecting all participants
   */
  async deleteRoom(roomName) {
    if (!roomName) return { success: false };
    return this._callTwirp('DeleteRoom', { room: roomName });
  }

  /**
   * Mute a published track server-side
   */
  async muteTrack(roomName, identity, trackSid, muted = true) {
    if (!roomName || !identity || !trackSid) return { success: false };
    return this._callTwirp('MutePublishedTrack', {
      room: roomName,
      identity,
      track_sid: trackSid,
      muted
    });
  }

  /**
   * Forcibly remove a participant from a room
   */
  async removeParticipant(roomName, identity) {
    if (!roomName || !identity) return { success: false };
    return this._callTwirp('RemoveParticipant', {
      room: roomName,
      identity
    });
  }

  /**
   * Update participant publishing permissions
   */
  async updateParticipant(roomName, identity, permission = {}) {
    if (!roomName || !identity) return { success: false };
    return this._callTwirp('UpdateParticipant', {
      room: roomName,
      identity,
      permission
    });
  }

  /**
   * Send broadcast data packet via server
   */
  async sendData(roomName, dataObject, destinationIdentities = []) {
    if (!roomName || !dataObject) return { success: false };
    const payloadStr = typeof dataObject === 'string' ? dataObject : JSON.stringify(dataObject);
    const base64Data = Buffer.from(payloadStr).toString('base64');
    return this._callTwirp('SendData', {
      room: roomName,
      data: base64Data,
      kind: 0, // reliable
      destination_identities: destinationIdentities
    });
  }
}

export const livekitService = new LiveKitService();
