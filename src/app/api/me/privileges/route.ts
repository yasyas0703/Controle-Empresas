import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ isGhost: false, isDeveloper: false, isPrivileged: false });
  }

  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  if (!token) {
    return NextResponse.json({ isGhost: false, isDeveloper: false, isPrivileged: false });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    return NextResponse.json({ isGhost: false, isDeveloper: false, isPrivileged: false });
  }

  const ghostId = process.env.GHOST_USER_ID;
  const devId = process.env.DEVELOPER_USER_ID;
  const isGhost = !!ghostId && data.user.id === ghostId;
  const isDeveloper = !!devId && data.user.id === devId;

  // Retornar IDs protegidos apenas para usuários privilegiados (UX: esconder botões de ação)
  const protectedUserIds: string[] = [];
  if (isGhost || isDeveloper) {
    if (ghostId) protectedUserIds.push(ghostId);
    if (devId) protectedUserIds.push(devId);
  }

  return NextResponse.json({
    isGhost,
    isDeveloper,
    isPrivileged: isGhost || isDeveloper,
    protectedUserIds,
  });
}
