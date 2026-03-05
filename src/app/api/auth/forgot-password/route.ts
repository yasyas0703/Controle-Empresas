import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomInt } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { sendEmail } from '@/lib/email';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

function generate6DigitCode(): string {
  return randomInt(100000, 999999).toString();
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function buildPasswordResetEmail(code: string) {
  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin:0; padding:0; background-color:#f4f6f9; font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9; padding:40px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; box-shadow:0 2px 12px rgba(0,0,0,0.08); overflow:hidden;">
              <tr>
                <td style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding:32px 40px; text-align:center;">
                  <h1 style="color:#ffffff; margin:0; font-size:22px; font-weight:600; letter-spacing:0.5px;">
                    Redefinição de Senha
                  </h1>
                </td>
              </tr>
              <tr>
                <td style="padding:36px 40px 20px;">
                  <p style="color:#374151; font-size:15px; line-height:1.7; margin:0 0 20px;">
                    Você solicitou a redefinição de senha da sua conta. Use o código de verificação abaixo para continuar:
                  </p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" style="padding:12px 0 24px;">
                        <div style="display:inline-block; background-color:#f0f5ff; border:2px dashed #2563eb; border-radius:10px; padding:18px 40px;">
                          <span style="font-size:36px; font-weight:700; letter-spacing:8px; color:#1e3a5f; font-family:'Courier New', monospace;">
                            ${code}
                          </span>
                        </div>
                      </td>
                    </tr>
                  </table>
                  <p style="color:#6b7280; font-size:14px; line-height:1.6; margin:0 0 8px;">
                    Este código expira em <strong style="color:#374151;">10 minutos</strong>.
                  </p>
                  <p style="color:#6b7280; font-size:14px; line-height:1.6; margin:0;">
                    Se você não solicitou esta redefinição, ignore este e-mail. Sua senha permanecerá inalterada.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 40px 32px; border-top:1px solid #e5e7eb; margin-top:20px;">
                  <p style="color:#9ca3af; font-size:12px; line-height:1.5; margin:0; text-align:center;">
                    Este é um e-mail automático. Por favor, não responda.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `.trim();

  const text = `Você solicitou a redefinição de senha. Seu código de verificação é: ${code}. Este código expira em 10 minutos. Se você não solicitou esta redefinição, ignore este e-mail.`;

  return { html, text };
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: max 5 requests per 10 minutes per IP
    const ip = getClientIp(request);
    const rl = rateLimit(`forgot-pwd:${ip}`, 5, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: true, message: 'Se o email existir, enviaremos instruções' },
        { status: 200 }
      );
    }

    const body = await request.json();
    const { email } = body;

    const genericResponse = NextResponse.json(
      { success: true, message: 'Se o email existir, enviaremos instruções' },
      { status: 200 }
    );

    if (!email || typeof email !== 'string') {
      return genericResponse;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const admin = getSupabaseAdmin();

    // Look up user by email in usuarios table
    const { data: user } = await admin
      .from('usuarios')
      .select('id, email, ativo')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!user || !user.ativo) {
      return genericResponse;
    }

    // Rate limit per user: check if a code was sent in the last 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recentCodes } = await admin
      .from('email_verification_codes')
      .select('id')
      .eq('user_id', user.id)
      .eq('used', false)
      .gte('created_at', twoMinutesAgo)
      .limit(1);

    if (recentCodes && recentCodes.length > 0) {
      return genericResponse;
    }

    // Generate 6-digit code and hash it
    const code = generate6DigitCode();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await admin.from('email_verification_codes').insert({
      user_id: user.id,
      code_hash: codeHash,
      expires_at: expiresAt,
      used: false,
      attempts: 0,
    });

    // Send email
    const { html, text } = buildPasswordResetEmail(code);
    await sendEmail(normalizedEmail, 'Redefinição de Senha - Código de Verificação', html, text);

    return genericResponse;
  } catch (error) {
    console.error('Erro em forgot-password:', error);
    return NextResponse.json(
      { success: false, message: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
