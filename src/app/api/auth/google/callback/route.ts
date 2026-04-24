import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getOAuthClient, verifyState, encryptToken } from '@/lib/googleOAuth';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

function redirectTo(path: string, search: Record<string, string>) {
  const params = new URLSearchParams(search).toString();
  const url = `${path}${params ? `?${params}` : ''}`;
  return NextResponse.redirect(new URL(url, process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000'));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return redirectTo('/obrigacoes', { gmail: 'error', reason: oauthError });
  }
  if (!code || !state) {
    return redirectTo('/obrigacoes', { gmail: 'error', reason: 'missing_params' });
  }

  const verified = verifyState(state);
  if (!verified) {
    return redirectTo('/obrigacoes', { gmail: 'error', reason: 'invalid_state' });
  }

  try {
    const oauth2 = getOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      // Usuário já havia autorizado antes — Google só manda refresh na primeira vez.
      // Solução: o consent com prompt=consent força a re-emissão. Se chegou aqui sem refresh,
      // significa algo deu errado no prompt.
      return redirectTo('/obrigacoes', { gmail: 'error', reason: 'no_refresh_token' });
    }

    oauth2.setCredentials(tokens);
    const oauth2api = google.oauth2({ version: 'v2', auth: oauth2 });
    const { data: userInfo } = await oauth2api.userinfo.get();
    if (!userInfo.email) {
      return redirectTo('/obrigacoes', { gmail: 'error', reason: 'no_email' });
    }

    const admin = getSupabaseAdmin();
    const encryptedRefresh = encryptToken(tokens.refresh_token);

    const { error } = await admin
      .from('usuario_gmail_tokens')
      .upsert(
        {
          usuario_id: verified.userId,
          email: userInfo.email,
          refresh_token_enc: encryptedRefresh,
          scope: tokens.scope || '',
          token_type: tokens.token_type || null,
          expiry_date: tokens.expiry_date || null,
          revoked: false,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: 'usuario_id' }
      );

    if (error) {
      return redirectTo('/obrigacoes', { gmail: 'error', reason: 'db_error' });
    }

    return redirectTo('/obrigacoes', { gmail: 'connected', email: userInfo.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return redirectTo('/obrigacoes', { gmail: 'error', reason: 'exchange_failed', detail: message.slice(0, 100) });
  }
}
