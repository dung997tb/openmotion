import { canvasCommandSchemas } from './canvas-schema.ts';
import { contentCommandSchemas } from './content-schema.ts';
import { timelineCommandSchemas } from './timeline-schema.ts';

const moveClipSchema = {
  type: 'object',
  properties: {
    kind: { enum: ['moveClip'] },
    compositionPath: { type: 'string', minLength: 1, maxLength: 240 },
    hfId: { type: 'string', minLength: 1, maxLength: 100 },
    start: { type: 'number', minimum: 0 },
  },
  required: ['kind', 'compositionPath', 'hfId', 'start'],
  additionalProperties: false,
};

const gradeMediaSchema = {
  type: 'object', additionalProperties: false, required: ['kind', 'compositionPath', 'value'],
  properties: { kind: { enum: ['gradeMedia'] }, compositionPath: { type: 'string', minLength: 1, maxLength: 240 },
    value: { type: ['string', 'null'], maxLength: 65536 } },
};
const beatGridSchema = {
  type: 'object', additionalProperties: false, required: ['kind', 'assetPath', 'beats'],
  properties: { kind: { enum: ['setBeatGrid'] }, assetPath: { type: 'string', minLength: 1, maxLength: 220 },
    compositionPath: { type: 'string', minLength: 1, maxLength: 240 },
    beats: { type: 'array', maxItems: 100000, items: { type: 'object', additionalProperties: false, required: ['time', 'strength'],
      properties: { time: { type: 'number', minimum: 0 }, strength: { type: 'number', minimum: 0, maximum: 1 } } } } },
};
export const commandSchemas = [moveClipSchema, beatGridSchema, gradeMediaSchema, ...timelineCommandSchemas, ...canvasCommandSchemas, ...contentCommandSchemas];
export const editSchemaDefinitions = { projectCommand: { oneOf: commandSchemas } };
const commandRef = { $ref: '#/$defs/projectCommand' };
export const editRequestSchema = { oneOf: [commandRef, {
  type: 'object',
  properties: {
    kind: { enum: ['batch'] },
    commands: { type: 'array', minItems: 1, maxItems: 100, items: commandRef },
  },
  required: ['kind', 'commands'],
  additionalProperties: false,
}] };
