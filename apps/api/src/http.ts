import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { assignmentStatusById } from './assignments/queries.js';

export async function rejectIfArchived(id: number, reply: FastifyReply): Promise<boolean> {
  if (assignmentStatusById(id) === 'archived') {
    conflict(reply, 'Assignment is archived');
    return true;
  }
  return false;
}

export function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.status(400).send({ error: message });
}

export function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.status(404).send({ error: message });
}

export function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.status(409).send({ error: message });
}

export function parseOr400<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  data: unknown,
  reply: FastifyReply,
  message?: string
): z.infer<TSchema> | null {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    reply.status(400).send({ error: message ?? parsed.error.issues[0]?.message ?? 'Invalid request' });
    return null;
  }
  return parsed.data;
}

export function safeJsonParse<T>(value: string | null): T {
  if (!value) {
    return [] as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return [] as T;
  }
}

export function parseIdParam(params: unknown): number | null {
  const id = Number((params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}
