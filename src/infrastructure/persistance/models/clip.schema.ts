import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ClipDocument = Clip & Document;

@Schema({ collection: 'clips', timestamps: true })
export class Clip {
  @Prop({ required: true, unique: true })
  clipId: string;

  @Prop({ required: true })
  type: number;

  @Prop({ required: true })
  category: number;

  @Prop({ required: true, default: 0 })
  flag: number;

  @Prop({ required: true })
  authorXuid: string;

  @Prop({ required: true, default: '' })
  title: string;

  @Prop({ required: true, default: 0 })
  i16_1: number;

  @Prop({ required: true, default: '' })
  description: string;

  @Prop({ required: true, default: '' })
  extraText: string;

  @Prop({ required: true, default: 0 })
  i16_2: number;

  @Prop({ type: Buffer, required: false })
  extraData: Buffer;

  @Prop({ required: true, default: 0 })
  u32Trailer: number;

  @Prop({ type: [[String]], required: true, default: [] })
  pairs: string[][];

  @Prop({ required: true, default: 0 })
  u32Trailer2: number;

  @Prop({ required: true, default: 0 })
  u64Trailer: string;

  @Prop({ required: false })
  demoFilename: string;

  @Prop({ type: [Number], required: true, default: [] })
  timestamps: number[];

  // Clip binary data
  @Prop({ type: Buffer, required: false })
  clipData: Buffer;
}

export const ClipSchema = SchemaFactory.createForClass(Clip);
