import { z } from 'zod';

import type { TelegramService } from './service.js';

const privateMessage = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: z.object({
    chat: z.object({ id: z.number().int().positive().safe(), type: z.literal('private') }),
    from: z.object({
      id: z.number().int().positive().safe(),
      is_bot: z.literal(false),
      username: z.string().optional(),
      first_name: z.string(),
    }),
    text: z.string(),
  }),
});

type UpdateService = Pick<TelegramService, 'webhook' | 'config'>;
export type TelegramReply = { chatId: number; text: string };

export async function handleTelegramUpdate(
  service: UpdateService,
  update: unknown,
): Promise<TelegramReply | undefined> {
  const payload = privateMessage.safeParse(update);
  if (!payload.success) return;
  const { update_id, message } = payload.data;
  const chatId = message.chat.id;
  if (chatId !== message.from.id) return;
  const command = message.text.trim();
  const startCode = /^\/start\s+([A-Za-z0-9_-]{43})$/.exec(command)?.[1];
  const stop = command === '/stop';
  if (!startCode && !stop) {
    if (!/^\/start(?:\s|$)/.test(command) && command !== '/help') return;
    return {
      chatId,
      text: [
        'To connect Telegram, open Account & Vault in Rulebook and select Telegram notifications.',
        'Choose Connect Telegram to get a fresh pairing link. Open it, tap Start, then return to Rulebook to confirm.',
        new URL('/account', service.config.appOrigin).href,
      ].join('\n'),
    };
  }

  const label = message.from.username
    ? `@${message.from.username}`
    : message.from.first_name.trim();
  const profile = Array.from(label).slice(0, 100).join('') || 'Telegram user';
  const handled = await service.webhook(update_id, chatId, profile, startCode ?? null);
  if (!handled) return;
  return {
    chatId,
    text: stop
      ? 'Telegram alerts from Rulebook have been disconnected for this chat.'
      : 'Return to Rulebook and confirm this Telegram account to finish connecting.',
  };
}
