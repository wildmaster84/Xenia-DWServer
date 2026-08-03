import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { TITLE_ID } from '../core/bb-constants';

export interface XboxPresSession {
  sessionId: string;
  xuid: string;
  hostAddress: string;
  macAddress: string;
  port: number;
  flags: number;
  publicSlotsCount: number;
  privateSlotsCount: number;
}

export interface XboxPresSearchResult {
  sessionId: string;
  xuid: string;
  hostAddress: string;
  macAddress: string;
  port: number;
  flags: number;
  publicSlotsCount: number;
  privateSlotsCount: number;
}

@Injectable()
export class XboxPresClient {
  private readonly logger = new Logger('XboxPresClient');
  private http: AxiosInstance;
  private readonly baseUrl = 'https://xboxpreservation.org';
  private readonly titleHex: string;

  constructor() {
    this.http = axios.create({
      timeout: 10000,
      headers: { 'User-Agent': 'xenia' },
    });
    this.titleHex = TITLE_ID.toString(16).toUpperCase().padStart(8, '0');
  }

  async postSession(session: {
    sessionId: string;
    xuid: string;
    flags: number;
    publicSlotsCount: number;
    privateSlotsCount: number;
    hostAddress: string;
    macAddress: string;
    port: number;
  }): Promise<void> {
    try {
      await this.http.post(
        `${this.baseUrl}/title/${this.titleHex}/sessions`,
        {
          sessionId: session.sessionId,
          xuid: session.xuid,
          title: '',
          mediaId: '',
          version: '',
          flags: session.flags,
          publicSlotsCount: session.publicSlotsCount,
          privateSlotsCount: session.privateSlotsCount,
          userIndex: 0,
          hostAddress: session.hostAddress,
          macAddress: session.macAddress,
          port: session.port,
        },
      );
    } catch (err) {
      this.logger.warn(`postSession failed: ${err}`);
    }
  }

  async deleteSession(xuidHex: string): Promise<void> {
    try {
      await this.http.delete(
        `${this.baseUrl}/title/${this.titleHex}/sessions/${xuidHex}`,
      );
    } catch (err) {
      this.logger.warn(`deleteSession failed: ${err}`);
    }
  }

  async getSession(xuidHex: string): Promise<XboxPresSession | null> {
    try {
      const res = await this.http.get(
        `${this.baseUrl}/title/${this.titleHex}/sessions/${xuidHex}`,
      );
      return this.normalizeSession(res.data);
    } catch (err) {
      this.logger.warn(`getSession failed: ${err}`);
      return null;
    }
  }

  async searchSessions(
    searcherXuid: string,
    maxResults = 50,
  ): Promise<XboxPresSearchResult[]> {
    try {
      const res = await this.http.post(
        `${this.baseUrl}/title/${this.titleHex}/sessions/search`,
        {
          searchIndex: 0,
          resultsCount: maxResults,
          numUsers: 0,
          searcher_xuid: searcherXuid,
        },
      );
      const data = res.data;
      if (!Array.isArray(data)) return [];
      return data.map((s: any) => this.normalizeSearchResult(s));
    } catch (err) {
      this.logger.warn(`searchSessions failed: ${err}`);
      return [];
    }
  }

  private normalizeSession(raw: any): XboxPresSession {
    return {
      sessionId: String(raw.id || raw.sessionId || raw.session_id || ''),
      xuid: String(raw.xuid || ''),
      hostAddress: String(raw.hostAddress || raw.host_address || ''),
      macAddress: String(raw.macAddress || raw.mac_address || ''),
      port: Number(raw.port) || 36000,
      flags: Number(raw.flags) || 0,
      publicSlotsCount: Number(raw.publicSlotsCount || raw.public_slots) || 18,
      privateSlotsCount: Number(raw.privateSlotsCount || raw.private_slots) || 0,
    };
  }

  private normalizeSearchResult(raw: any): XboxPresSearchResult {
    return this.normalizeSession(raw) as XboxPresSearchResult;
  }
}
