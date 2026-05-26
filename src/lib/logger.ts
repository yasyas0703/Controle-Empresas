// Logger estruturado (JSON) com redaction de campos sensíveis.
//
// Uso típico em uma rota API:
//   import { logger } from '@/lib/logger';
//   logger.info({ action: 'envio_iniciado', empresaId, userId }, 'envio fiscal');
//   logger.error({ err, ctx: { empresaId } }, 'falha no envio');
//
// IMPORTANTE — onde NÃO usar:
// - `src/proxy.ts` (Next.js middleware) roda no Edge Runtime, que NÃO suporta
//   pino (depende de APIs Node como `process.stdout` e worker_threads). Em
//   middleware/edge use `console.*` mesmo.
// - Client Components (`'use client'`) também não devem importar pino — vai
//   pro bundle do browser e infla MB sem ganho.
//
// Migração de console.* existentes é gradual: este módulo só adiciona uma
// alternativa. Os console.error/log atuais continuam funcionando.

import pino, { type Logger, type LoggerOptions } from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

// Campos que NUNCA podem ir pra log. A lista cobre nomes comuns + os
// específicos deste projeto (refresh_token_enc, senha_provisoria, etc).
// `pino` redact aceita paths com wildcards — `*.password` captura
// `body.password`, `req.body.password`, etc.
const REDACT_PATHS = [
  // Genéricos
  'password',
  'passwd',
  'senha',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'secret',
  'apiKey',
  'api_key',
  // Específicos deste projeto
  'refresh_token_enc',
  'senha_provisoria',
  'senhaTemporaria',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_CLIENT_SECRET',
  'GMAIL_TOKEN_ENCRYPTION_KEY',
  'SSO_SHARED_SECRET',
  'AUTO_ENVIO_TOKEN',
  'VAPID_PRIVATE_KEY',
  'SMTP_PASS',
  'CRON_SECRET',
  // Wildcards pra pegar nested
  '*.password',
  '*.senha',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
  '*.cookie',
  '*.refresh_token_enc',
  '*.senha_provisoria',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
];

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
    remove: false,
  },
  // Sem `pid` e `hostname` em prod — só adicionam ruído nos agregadores.
  base: isDev ? undefined : { service: 'controle-triar' },
  // Timestamp em ISO 8601 (compatível com Datadog, CloudWatch, etc).
  timestamp: pino.stdTimeFunctions.isoTime,
};

// Em dev: pino-pretty pra leitura no terminal. Em prod: JSON puro pra
// stdout (Vercel agrega automaticamente).
const devTransport = isDev
  ? {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: false,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    }
  : {};

export const logger: Logger = pino({ ...baseOptions, ...devTransport });

// Cria um child logger com contexto fixo. Use em rotas pra correlacionar
// múltiplas linhas de log do mesmo request:
//   const log = childLogger({ requestId, userId, route: '/api/x' });
//   log.info('start'); ... log.info('done');
export function childLogger(ctx: Record<string, unknown>): Logger {
  return logger.child(ctx);
}
