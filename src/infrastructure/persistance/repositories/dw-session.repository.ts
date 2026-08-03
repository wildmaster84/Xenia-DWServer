import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DWSession, DWSessionDocument } from '../models/dw-session.schema';

@Injectable()
export class DWSessionRepository {
  constructor(
    @InjectModel(DWSession.name) private model: Model<DWSessionDocument>,
  ) {}

  async create(session: Partial<DWSession> & { sessionId: string; xuid: string }): Promise<void> {
    await this.model.findOneAndUpdate(
      { sessionId: session.sessionId },
      session,
      { upsert: true, new: true },
    ).exec();
  }

  async getByXuid(xuid: string): Promise<any | null> {
    return this.model.findOne({ xuid }).lean().exec() as any;
  }

  async getBySessionId(sessionId: string): Promise<any | null> {
    return this.model.findOne({ sessionId }).lean().exec() as any;
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
