import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DWSession, DWSessionDocument } from '../models/dw-session.schema';

@Injectable()
export class DWSessionRepository {
  constructor(
    @InjectModel(DWSession.name) private model: Model<DWSessionDocument>,
  ) {}

  private toBuffer(data: any): Buffer | null {
    if (!data) return null;
    if (Buffer.isBuffer(data)) return data;
    if (data && typeof data === 'object' && data.buffer) {
      return Buffer.from(data.buffer);
    }
    if (data && typeof data === 'object' && data.subarray) {
      return Buffer.from(data.subarray());
    }
    try {
      return Buffer.from(data);
    } catch {
      return null;
    }
  }

  async create(session: Partial<DWSession> & { sessionId: string; xuid: string }): Promise<void> {
    await this.model.findOneAndUpdate(
      { sessionId: session.sessionId },
      session,
      { upsert: true, new: true },
    ).exec();
  }

  async getByXuid(xuid: string): Promise<any | null> {
    const doc = await this.model.findOne({ xuid }).lean().exec() as any;
    if (doc) {
      doc.xnkey = this.toBuffer(doc.xnkey);
      doc.xnaddr = this.toBuffer(doc.xnaddr);
    }
    return doc;
  }

  async getBySessionId(sessionId: string): Promise<any | null> {
    const doc = await this.model.findOne({ sessionId }).lean().exec() as any;
    if (doc) {
      doc.xnkey = this.toBuffer(doc.xnkey);
      doc.xnaddr = this.toBuffer(doc.xnaddr);
    }
    return doc;
  }

  async getBySessionIds(sessionIds: string[]): Promise<any[]> {
    const docs = await this.model.find({ sessionId: { $in: sessionIds } }).lean().exec() as any[];
    for (const doc of docs) {
      doc.xnkey = this.toBuffer(doc.xnkey);
      doc.xnaddr = this.toBuffer(doc.xnaddr);
    }
    return docs;
  }

  async update(sessionId: string, updates: Partial<DWSession>): Promise<void> {
    await this.model.updateOne({ sessionId }, updates).exec();
  }

  async delete(sessionId: string): Promise<void> {
    await this.model.deleteOne({ sessionId }).exec();
  }

  async deleteByXuid(xuid: string): Promise<void> {
    await this.model.deleteMany({ xuid }).exec();
  }
}
