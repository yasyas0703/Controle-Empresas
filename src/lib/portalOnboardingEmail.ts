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
    `Para acesso rápido pelo celular, instale o portal como aplicativo: depois de logar, abra o menu do navegador e selecione "Adicionar à tela inicial". Você passa a receber notificações de novas guias diretamente no aparelho.`,
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

    <div style="border: 1px solid #e5e7eb; border-left: 3px solid #10b981; padding: 12px 14px; margin: 20px 0; border-radius: 4px;">
      <div style="font-size: 13px; color: #374151; font-weight: 600; margin-bottom: 4px;">Acesso pelo celular</div>
      <div style="font-size: 12px; color: #4b5563; line-height: 1.5;">
        Para instalar o portal como aplicativo no seu celular, depois de logar abra o menu do navegador e selecione <strong>"Adicionar à tela inicial"</strong>. Você passa a receber notificações de novas guias diretamente no aparelho.
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

export function buildEmpresaAdicionalEmail(params: {
  empresaNome: string;
  email: string;
  portalUrl: string;
  contatoNome?: string;
}): { subject: string; bodyText: string; bodyHtml: string } {
  const saudacao = params.contatoNome ? `Olá, ${params.contatoNome}!` : `Olá!`;
  const subject = `Novo acesso adicionado — ${params.empresaNome}`;

  const bodyText = [
    saudacao,
    '',
    `Vinculamos uma nova empresa ao seu acesso no Portal Triar Contabilidade.`,
    '',
    `Empresa adicionada: ${params.empresaNome}`,
    '',
    `Você continua usando a MESMA senha que já tem.`,
    `  Email: ${params.email}`,
    '',
    `Ao entrar no portal, vai aparecer uma tela pra você escolher qual empresa quer visualizar.`,
    '',
    `Acesse: ${params.portalUrl}`,
    '',
    `Qualquer dúvida, é só chamar.`,
    '',
    `Atenciosamente,`,
    `Equipe Triar Contabilidade`,
  ].join('\n');

  const bodyHtml = `
<div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; color: #0f172a;">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 20px 24px; border-radius: 8px 8px 0 0; color: white;">
    <h1 style="margin: 0; font-size: 20px;">➕ Nova empresa no seu acesso</h1>
    <p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">${escapeHtml(params.empresaNome)}</p>
  </div>
  <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-top: 0; border-radius: 0 0 8px 8px;">
    <p style="font-size: 15px; margin: 0 0 16px;">${escapeHtml(saudacao)}</p>
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
      Vinculamos uma nova empresa ao seu acesso. Ao entrar, vai aparecer uma tela pra escolher qual empresa visualizar.
    </p>
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #15803d; font-weight: bold; margin-bottom: 8px;">
        Você continua usando a senha atual
      </div>
      <div style="font-size: 13px; color: #374151;"><strong>Email:</strong> ${escapeHtml(params.email)}</div>
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${escapeHtml(params.portalUrl)}" style="display: inline-block; background: #10b981; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
        Acessar o portal
      </a>
    </div>
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

export function buildEmailAlteradoEmail(params: {
  email: string;          // novo email
  emailAntigo: string;
  portalUrl: string;
  contatoNome?: string;
}): { subject: string; bodyText: string; bodyHtml: string } {
  const saudacao = params.contatoNome ? `Olá, ${params.contatoNome}!` : `Olá!`;
  const subject = `Seu email de acesso ao Portal Triar foi alterado`;

  const bodyText = [
    saudacao,
    '',
    `O email que você usa pra logar no Portal Triar Contabilidade foi alterado.`,
    '',
    `  Email antigo: ${params.emailAntigo}`,
    `  Email novo:   ${params.email}`,
    '',
    `Sua SENHA continua a mesma — só o email mudou.`,
    '',
    `Acesse: ${params.portalUrl}`,
    '',
    `Se você não pediu essa alteração, entre em contato com o escritório imediatamente.`,
    '',
    `Atenciosamente,`,
    `Equipe Triar Contabilidade`,
  ].join('\n');

  const bodyHtml = `
<div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; color: #0f172a;">
  <div style="background: linear-gradient(135deg, #475569 0%, #334155 100%); padding: 20px 24px; border-radius: 8px 8px 0 0; color: white;">
    <h1 style="margin: 0; font-size: 20px;">✉️ Email de acesso alterado</h1>
    <p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">Portal Triar Contabilidade</p>
  </div>
  <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-top: 0; border-radius: 0 0 8px 8px;">
    <p style="font-size: 15px; margin: 0 0 16px;">${escapeHtml(saudacao)}</p>
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
      O email que você usa pra logar no Portal foi alterado.
    </p>
    <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <div style="font-size: 13px; color: #475569; margin-bottom: 6px;">
        <strong>Email antigo:</strong> <span style="text-decoration: line-through;">${escapeHtml(params.emailAntigo)}</span>
      </div>
      <div style="font-size: 13px; color: #0f172a;">
        <strong>Email novo:</strong> ${escapeHtml(params.email)}
      </div>
    </div>
    <p style="font-size: 13px; line-height: 1.6; margin: 0 0 16px; color: #475569;">
      Sua <strong>senha continua a mesma</strong> — só o email mudou.
    </p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${escapeHtml(params.portalUrl)}" style="display: inline-block; background: #10b981; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
        Acessar o portal
      </a>
    </div>
    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 14px; margin: 20px 0; border-radius: 4px;">
      <div style="font-size: 12px; color: #78350f; line-height: 1.5;">
        <strong>Não pediu essa alteração?</strong> Entre em contato com o escritório imediatamente.
      </div>
    </div>
    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    <p style="font-size: 12px; color: #6b7280; margin: 0;">
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
