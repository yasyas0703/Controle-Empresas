import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { autenticarRequest, isErroApi } from '@/app/api/checklist-fiscal/_shared';
import { lerLogsArquivados } from '@/lib/logsArquivo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Consulta os detalhes (diff) arquivados no Storage pra um intervalo de datas.
// Usado pela página /historico pra recuperar o "antes → depois" de edições com
// mais de 30 dias (que saíram do banco mas estão guardadas no arquivo).
// Gate: cookie de staff (proxy) + token Supabase válido + papel admin/ghost.
export async function GET(req: Request) {
  const auth = await autenticarRequest(req);
  if (isErroApi(auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = getSupabaseAdmin();
  const ghostId = process.env.GHOST_USER_ID || null;
  const isGhost = !!ghostId && auth.userId === ghostId;
  if (!isGhost) {
    const { data: u } = await admin.from('usuarios').select('role').eq('id', auth.userId).maybeSingle();
    const role = (u as { role?: string } | null)?.role;
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Apenas administradores e a conta ghost consultam o histórico.' }, { status: 403 });
    }
  }

  const url = new URL(req.url);
  const de = url.searchParams.get('de');
  const ate = url.searchParams.get('ate');
  if (!de || !ate) {
    return NextResponse.json({ error: 'Informe os parâmetros de e ate (ISO).' }, { status: 400 });
  }

  try {
    const rows = await lerLogsArquivados(admin, { deIso: de, ateIso: ate });
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    // Detalhe técnico só no log — corpo HTTP genérico.
    console.error('[historico-arquivo] erro ao ler arquivo:', err);
    return NextResponse.json({ error: 'Erro ao ler o arquivo do histórico.' }, { status: 500 });
  }
}
