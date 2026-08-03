import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DWSessionDocument = DWSession & Document;

/**
 * Demonware-level session (bdMatchmaking).
 * This is separate from the Xenia WebServices Session schema.
 * The DW session holds XNADDR, XNKEY, and matchmaking-specific fields.
 */
@Schema({ collection: 'dw_sessions', timestamps: true })
export class DWSession {
  @Prop({ required: true, unique: true })
  sessionId: string;

  @Prop({ required: true })
  xuid: string;

  @Prop({ required: true })
  hostIp: string;

  @Prop({ type: Buffer, required: false })
  macAddress: Buffer;

  @Prop({ required: true, default: '' })
  macAddressStr: string;

  @Prop({ required: true, default: 36000 })
  port: number;

  @Prop({ required: true, default: 0 })
  flags: number;

  @Prop({ required: true, default: 18 })
  publicSlots: number;

  @Prop({ required: true, default: 0 })
  privateSlots: number;

  @Prop({ required: true, default: 0 })
  titleId: number;

  @Prop({ type: Buffer, required: false })
  xnkey: Buffer;

  @Prop({ type: Buffer, required: false })
  xnaddr: Buffer;

  // Matchmaking fields (field_0x13C through field_0x16C)
  @Prop({ type: [Number], required: false, default: [] })
  intFields: number[];

  @Prop({ type: Number, required: false })
  floatField: number;

  @Prop({ type: [Number], required: false, default: [] })
  intFields2: number[];
}

export const DWSessionSchema = SchemaFactory.createForClass(DWSession);
