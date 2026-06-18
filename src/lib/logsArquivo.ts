import type { getSupabaseAdmin } from '@/lib/supabaseAdmin';

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

// Bucket de Storage (cota separada dos 500MB do banco) onde guardamos o diff
// pesado dos logs antigos antes de zerá-lo no Postgres. Privado: só o
// service-role (cron + rota de consulta) acessa; o browser nunca toca direto.
export const BUCKET_LOGS_ARQUIVO = 'logs-arquivo';

// A linha inteira é arquivada (não só o diff) pra reconstruir o detalhe completo.
const COLS = 'id, em, user_id, user_nome, action, entity, entity_id, message, diff, deleted_em, deleted_by_id, deleted_by_nome';

interface LinhaLog {
  id: string;
  em: string;
  diff: unknown;
  [k: string]: unknown;
}

async function garantirBucket(admin: SupabaseAdmin): Promise<void> {
  const { data } = await admin.storage.getBucket(BUCKET_LOGS_ARQUIVO);
  if (data) return;
  const { error } = await admin.storage.createBucket(BUCKET_LOGS_ARQUIVO, { public: false });
  // Idempotente: se outra execução criou no meio, "already exists" não é erro.
  if (error && !/exist/i.test(error.message || '')) throw error;
}

function stampRun(): string {
  // Roda em API route / cron (runtime nodejs), então new Date() é permitido aqui.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface ArquivarResult {
  arquivados: number;
  compactados: number;
}

/**
 * Move o diff pesado de logs com `em < corteIso` pro Storage (NDJSON, um arquivo
 * por mês/lote) e SÓ DEPOIS zera o diff no banco. Archive-then-null por lote: se
 * o upload falhar, o diff NÃO é apagado — tenta de novo na próxima rodada, então
 * nada se perde. Drena em lotes (bounded por maxBatches pra não estourar o tempo
 * da função); o backlog grande é drenado ao longo de várias execuções.
 */
export async function arquivarLogsAntigos(
  admin: SupabaseAdmin,
  opts: { corteIso: string; maxBatches?: number; batchSize?: number },
): Promise<ArquivarResult> {
  const { corteIso, maxBatches = 4, batchSize = 500 } = opts;
  let arquivados = 0;
  let compactados = 0;
  let bucketOk = false;

  for (let i = 0; i < maxBatches; i++) {
    const { data, error } = await admin
      .from('logs')
      .select(COLS)
      .lt('em', corteIso)
      .not('diff', 'is', null)
      .order('em', { ascending: true })
      .limit(batchSize);
    if (error) throw error;
    const linhas = (data ?? []) as unknown as LinhaLog[];
    if (linhas.length === 0) break;

    if (!bucketOk) { await garantirBucket(admin); bucketOk = true; }

    // Agrupa por mês (YYYY-MM, em UTC) — o `em` já vem ISO do Postgres.
    const porMes = new Map<string, LinhaLog[]>();
    for (const l of linhas) {
      const ym = String(l.em).slice(0, 7);
      const lista = porMes.get(ym);
      if (lista) lista.push(l); else porMes.set(ym, [l]);
    }

    const run = stampRun();
    for (const [ym, lista] of porMes) {
      const conteudo = lista.map((l) => JSON.stringify(l)).join('\n') + '\n';
      // Nome único por (mês, run, lote) → sem download/concat, sem sobrescrever.
      const path = `${ym}/${run}_b${i}.jsonl`;
      const { error: upErr } = await admin.storage
        .from(BUCKET_LOGS_ARQUIVO)
        .upload(path, Buffer.from(conteudo, 'utf-8'), { contentType: 'application/x-ndjson', upsert: true });
      if (upErr) throw upErr;
      arquivados += lista.length;
    }

    // Arquivado com sucesso → agora pode zerar o diff desses ids.
    const ids = linhas.map((l) => l.id);
    const { error: upd } = await admin.from('logs').update({ diff: null }).in('id', ids);
    if (upd) throw upd;
    compactados += ids.length;

    if (linhas.length < batchSize) break; // drenou tudo
  }

  return { arquivados, compactados };
}

export interface LogArquivado {
  id: string;
  em: string;
  diff: unknown;
}

/**
 * Lê os diffs arquivados de um intervalo de datas. Bounded: percorre só as
 * pastas de mês dentro do intervalo (+1 mês de folga em cada ponta, por causa de
 * fuso) e limita o total retornado. Dedup por id (último vence).
 */
export async function lerLogsArquivados(
  admin: SupabaseAdmin,
  opts: { deIso: string; ateIso: string; max?: number },
): Promise<LogArquivado[]> {
  const { deIso, ateIso, max = 5000 } = opts;
  const deMs = new Date(deIso).getTime();
  const ateMs = new Date(ateIso).getTime();
  if (Number.isNaN(deMs) || Number.isNaN(ateMs) || deMs > ateMs) return [];

  const meses = mesesNoIntervalo(deMs, ateMs);
  const porId = new Map<string, LogArquivado>();

  for (const ym of meses) {
    const { data: files, error } = await admin.storage.from(BUCKET_LOGS_ARQUIVO).list(ym, { limit: 1000 });
    if (error || !files) continue; // pasta inexistente = nada arquivado nesse mês
    for (const f of files) {
      if (!f.name.endsWith('.jsonl')) continue;
      const { data: blob, error: dErr } = await admin.storage.from(BUCKET_LOGS_ARQUIVO).download(`${ym}/${f.name}`);
      if (dErr || !blob) continue;
      const texto = await blob.text();
      for (const linha of texto.split('\n')) {
        if (!linha.trim()) continue;
        let row: LinhaLog;
        try { row = JSON.parse(linha) as LinhaLog; } catch { continue; }
        const ms = new Date(row.em).getTime();
        if (Number.isNaN(ms) || ms < deMs || ms > ateMs) continue;
        porId.set(row.id, { id: row.id, em: row.em, diff: row.diff });
        if (porId.size >= max) return Array.from(porId.values());
      }
    }
  }
  return Array.from(porId.values());
}

/** Lista "YYYY-MM" do mês de `de` até o de `ate`, com 1 mês de folga em cada ponta. */
function mesesNoIntervalo(deMs: number, ateMs: number): string[] {
  const UM_MES_MS = 31 * 24 * 60 * 60 * 1000;
  const ini = new Date(deMs - UM_MES_MS);
  const fim = new Date(ateMs + UM_MES_MS);
  const out: string[] = [];
  let y = ini.getUTCFullYear();
  let m = ini.getUTCMonth();
  const yFim = fim.getUTCFullYear();
  const mFim = fim.getUTCMonth();
  for (let guard = 0; guard < 360; guard++) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    if (y === yFim && m === mFim) break;
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}
