import type { FastifyReply } from 'fastify';
import { z } from 'zod';

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

export function parseIdParam(params: unknown): number | null {
  const id = Number((params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}
