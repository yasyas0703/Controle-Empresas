// Template do email de boas-vindas ao Portal do Cliente.

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
}

export function buildOnboardingEmail(params: {
  empresaNome: string;
  email: string;
  senhaTemporaria: string;
  portalUrl: string; // ex: https://app.../portal/login
  contatoNome?: string;
  reenvio?: boolean;
}): { subject: string; bodyText: string; bodyHtml: string } {
  const saudacao = params.contatoNome
    ? `Olá, ${params.contatoNome}!`
    : `Olá!`;

  const intro = params.reenvio
    ? 'Geramos uma nova senha provisória pra você acessar o portal.'
    : 'Criamos um acesso pra você no nosso Portal do Cliente da Triar Contabilidade.';

  const subject = params.reenvio
    ? `Nova senha de acesso — Portal Triar Contabilidade`
    : `Bem-vindo(a) ao Portal Triar Contabilidade`;

  const bodyText = [
    saudacao,
    '',
    `${intro} Por lá você recebe suas guias e documentos, baixa direto, marca como pago e recebe avisos antes de cada vencimento.`,
    '',
    `Empresa: ${params.empresaNome}`,
    '',
    `Dados de acesso:`,
    `  Email: ${params.email}`,
    `  Senha provisória: ${params.senhaTemporaria}`,
    '',
    `Acesse: ${params.portalUrl}`,
    '',
    `Recomendação: no celular, depois de logar, abra o menu do navegador e toque em "Adicionar à tela inicial" / "Instalar app". Vai parecer um aplicativo e você recebe notificações de novas guias.`,
    '',
    `Sugerimos trocar a senha provisória no primeiro acesso (em "Meu cadastro" → "Trocar senha").`,
    '',
    `Qualquer dúvida, é só chamar.`,
    '',
    `Atenciosamente,`,
    `Equipe Triar Contabilidade`,
  ].join('\n');

  const bodyHtml = `
<div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; color: #0f172a;">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 20px 24px; border-radius: 8px 8px 0 0; color: white;">
    <h1 style="margin: 0; font-size: 20px;">${params.reenvio ? '🔑 Nova senha' : '👋 Bem-vindo(a) ao Portal Triar'}</h1>
    <p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">${escapeHtml(params.empresaNome)}</p>
  </div>

  <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-top: 0; border-radius: 0 0 8px 8px;">
    <p style="font-size: 15px; margin: 0 0 16px;">${escapeHtml(saudacao)}</p>
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
      ${escapeHtml(intro)} Por lá você recebe suas guias e documentos da Triar Contabilidade, baixa direto, marca como pago e recebe avisos antes de cada vencimento.
    </p>

    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #15803d; font-weight: bold; margin-bottom: 8px;">
        Dados de acesso
      </div>
      <div style="font-size: 13px; color: #374151;"><strong>Email:</strong> ${escapeHtml(params.email)}</div>
      <div style="font-size: 13px; color: #374151; margin-top: 4px;">
        <strong>Senha provisória:</strong>
        <span style="font-family: 'Courier New', monospace; background: #fff; padding: 2px 6px; border-radius: 4px; border: 1px solid #d1d5db;">${escapeHtml(params.senhaTemporaria)}</span>
      </div>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${escapeHtml(params.portalUrl)}" style="display: inline-block; background: #10b981; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
        Acessar o portal
      </a>
    </div>

    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 14px; margin: 20px 0; border-radius: 4px;">
      <div style="font-size: 13px; color: #92400e; font-weight: 600; margin-bottom: 4px;">💡 Recomendação</div>
      <div style="font-size: 12px; color: #78350f; line-height: 1.5;">
        No celular, depois de logar, abra o menu do navegador (⋮) e toque em <strong>"Adicionar à tela inicial"</strong> ou <strong>"Instalar app"</strong>. Vai parecer um app de verdade e você recebe notificações de novas guias.
      </div>
    </div>

    <p style="font-size: 12px; color: #6b7280; margin: 16px 0 0;">
      Sugerimos trocar a senha provisória no primeiro acesso (em "Meu cadastro" → "Trocar senha").
    </p>

    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;">

    <p style="font-size: 12px; color: #6b7280; margin: 0;">
      Qualquer dúvida, é só chamar.<br>
      <strong>Equipe Triar Contabilidade</strong>
    </p>
  </div>
</div>
`.trim();

  return { subject, bodyText, bodyHtml };
}

export function gerarSenhaTemporaria(length = 12): string {
  // Caracteres sem confusão visual (sem 0/O, l/I, 1)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  // Crypto-secure se rodando em Node, fallback pro Math.random
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
    return out;
  } catch {
    let out = '';
    for (let i = 0; i < length; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }
}

export function resolvePortalUrl(req: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return `${fromEnv.replace(/\/+$/, '')}/portal/login`;
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) return `${proto}://${host}/portal/login`;
  return '/portal/login';
}
