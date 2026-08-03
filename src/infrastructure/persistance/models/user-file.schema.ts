import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserFileDocument = UserFile & Document;

@Schema({ collection: 'user_files', timestamps: true })
export class UserFile {
  @Prop({ required: true })
  xuid: string;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true, type: Buffer })
  data: Buffer;

  @Prop({ required: true })
  size: number;
}

export const UserFileSchema = SchemaFactory.createForClass(UserFile);
UserFileSchema.index({ xuid: 1, fileName: 1 }, { unique: true });
