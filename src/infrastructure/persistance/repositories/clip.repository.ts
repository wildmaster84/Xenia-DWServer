import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Clip, ClipDocument } from '../models/clip.schema';

@Injectable()
export class ClipRepository {
  constructor(
    @InjectModel(Clip.name) private model: Model<ClipDocument>,
  ) {}

  async getById(clipId: string): Promise<any | null> {
    return this.model.findOne({ clipId }).lean().exec() as any;
  }

  async getByAuthor(authorXuid: string): Promise<any[]> {
    return this.model.find({ authorXuid }).lean().exec() as any;
  }

  async getAll(): Promise<any[]> {
    return this.model.find({}).lean().exec() as any;
  }

  async save(clip: Partial<Clip> & { clipId: string }): Promise<void> {
    await this.model.findOneAndUpdate(
      { clipId: clip.clipId },
      clip,
      { upsert: true, new: true },
    ).exec();
  }

  async delete(clipId: string): Promise<void> {
    await this.model.deleteOne({ clipId }).exec();
  }

  async getByCategory(category: number): Promise<any[]> {
    return this.model.find({ category }).lean().exec() as any;
  }
}
