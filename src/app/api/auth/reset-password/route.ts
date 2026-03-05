import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: max 10 attempts per 10 minutes per IP
    const ip = getClientIp(request);
    const rl = rateLimit(`reset-pwd:${ip}`, 10, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, message: 'Muitas tentativas. Aguarde alguns minutos.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { email, code, newPassword } = body;

    if (!email || !code || !newPassword) {
      return NextResponse.json(
        { success: false, message: 'Email, código e nova senha são obrigatórios.' },
        { status: 400 }
      );
    }

    if (typeof newPassword !== 'string' || newPassword.trim().length < 8) {
      return NextResponse.json(
        { success: false, message: 'A senha deve ter no mínimo 8 caracteres.' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const admin = getSupabaseAdmin();

    // Look up user
    const { data: user } = await admin
      .from('usuarios')
      .select('id, ativo')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!user || !user.ativo) {
      return NextResponse.json(
        { success: false, message: 'Código inválido ou expirado.' },
        { status: 400 }
      );
    }

    // Find the most recent unused, non-expired code for this user
    const now = new Date().toISOString();
    const { data: verificationCode } = await admin
      .from('email_verification_codes')
      .select('*')
      .eq('user_id', user.id)
      .eq('used', false)
      .gt('expires_at', now)
      .lt('attempts', 5)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!verificationCode) {
      return NextResponse.json(
        { success: false, message: 'Código inválido ou expirado.' },
        { status: 400 }
      );
    }

    // Increment attempts
    await admin
      .from('email_verification_codes')
      .update({ attempts: verificationCode.attempts + 1 })
      .eq('id', verificationCode.id);

    // Verify the code
    const inputHash = hashCode(code.trim());
    if (inputHash !== verificationCode.code_hash) {
      const remaining = 4 - verificationCode.attempts;
      const msg = remaining > 0
        ? `Código incorreto. ${remaining} tentativa(s) restante(s).`
        : 'Código expirado. Solicite um novo código.';
      return NextResponse.json(
        { success: false, message: msg },
        { status: 400 }
      );
    }

    // Mark code as used
    await admin
      .from('email_verification_codes')
      .update({ used: true })
      .eq('id', verificationCode.id);

    // Update the user's password via Supabase Auth Admin
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password: newPassword.trim(),
    });

    if (updateError) {
      console.error('Erro ao atualizar senha:', updateError);
      return NextResponse.json(
        { success: false, message: 'Não foi possível alterar a senha. Tente novamente.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, message: 'Senha alterada com sucesso!' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Erro em reset-password:', error);
    return NextResponse.json(
      { success: false, message: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
