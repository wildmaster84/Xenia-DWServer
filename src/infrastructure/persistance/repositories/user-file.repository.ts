import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserFile, UserFileDocument } from '../models/user-file.schema';

@Injectable()
export class UserFileRepository {
  constructor(
    @InjectModel(UserFile.name) private model: Model<UserFileDocument>,
  ) {}

  async read(xuid: string, fileName: string): Promise<Buffer | null> {
    const doc = await this.model.findOne({ xuid, fileName }).lean().exec();
    if (!doc) return null;
    return this.toBuffer(doc.data);
  }

  private toBuffer(data: any): Buffer {
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
      return Buffer.alloc(0);
    }
  }

  async write(xuid: string, fileName: string, data: Buffer): Promise<void> {
    await this.model.findOneAndUpdate(
      { xuid, fileName },
      { xuid, fileName, data, size: data.length },
      { upsert: true, new: true },
    ).exec();
  }

  async list(xuid: string): Promise<{ fileName: string; size: number }[]> {
    const docs = await this.model.find({ xuid }).lean().exec();
    return docs.map((d) => ({ fileName: d.fileName, size: d.size }));
  }

  async exists(xuid: string, fileName: string): Promise<boolean> {
    const count = await this.model.countDocuments({ xuid, fileName }).exec();
    return count > 0;
  }
}
