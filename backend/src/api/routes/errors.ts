import type { FastifyReply } from 'fastify';

/** Sends the canonical `Error` shape from contracts/http-api.yaml. */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  detail: string | null = null,
): FastifyReply {
  return reply.status(status).send({ error: { code, message, detail } });
}
