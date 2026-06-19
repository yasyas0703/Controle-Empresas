// Conserto pontual e RE-RODÁVEL: certidões de PREFEITURA que entraram na coluna
// FEDERAL (classificação errada do parser antigo — tipoDoTexto checava FEDERAL
// antes de MUNICIPAL) voltam pra MUNICIPAL. A causa-raiz já foi corrigida no
// código (commit que prioriza município em _detectar.ts); este script limpa o
// que já estava no banco. Pode rodar de novo depois que o watcher catalogar mais.
//
// Mantém o mês; se a célula MUNICIPAL daquele mês já existe (conflito), joga pro
// mês da 1ª data do PDF, dentro de [2024-01..mês atual]. Se ainda colidir, deixa
// como está e reporta.
//
//   npx tsx scripts/reclassificar-municipal-em-federal.ts          # DRY-RUN
//   npx tsx scripts/reclassificar-municipal-em-federal.ts --apply
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireCJS = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfjsLib: any = requireCJS('pdfjs-dist/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

const APPLY = process.argv.includes('--apply');
const AGORA = new Date();
const MES_ATUAL = `${AGORA.getFullYear()}-${String(AGORA.getMonth() + 1).padStart(2, '0')}`;

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const p = resolve(__dirname, '..', '.env.local');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (process.env[k]) env[k] = process.env[k]!;
  return env;
}
const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function norm(s: string): string { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
async function extrairTexto(buf: Buffer, maxPaginas = 3): Promise<string> {
  try {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), useWorker: false, disableWorker: true, verbosity: 0 }).promise;
    const partes: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPaginas); p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      partes.push(content.items.map((i: { str?: string }) => i.str ?? '').join(' '));
    }
    return partes.join('\n');
  } catch { return ''; }
}

interface Row { id: string; empresa_id: string; certidao: string; mes: string; arquivo_url: string | null; arquivo_nome: string | null; }

void (async () => {
  const all: Row[] = []; let off = 0;
  while (true) {
    const { data } = await sb.from('checklist_cadastro').select('id, empresa_id, certidao, mes, arquivo_url, arquivo_nome').order('id').range(off, off + 999);
    const lote = data ?? []; all.push(...(lote as Row[]));
    if (lote.length < 1000) break; off += 1000;
  }
  const ocupado = new Map<string, string>();
  for (const r of all) ocupado.set(`${r.empresa_id}|${r.certidao}|${r.mes}`, r.id);

  const federais = all.filter((r) => r.certidao === 'FEDERAL' && r.arquivo_url);
  const planos: Array<{ r: Row; mes: string }> = [];
  const skip: Array<{ r: Row; motivo: string }> = [];

  for (const r of federais) {
    let texto = '';
    try { const dl = await sb.storage.from('documentos').download(r.arquivo_url!); if (dl.error || !dl.data) continue; texto = await extrairTexto(Buffer.from(await dl.data.arrayBuffer())); }
    catch { continue; }
    const t = norm(texto);
    if (!/prefeitura|fazenda publica municipal|secretaria municipal/.test(t)) continue; // só prefeitura na coluna federal
    let alvoMes = r.mes;
    if (ocupado.has(`${r.empresa_id}|MUNICIPAL|${alvoMes}`)) {
      const m = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const cand = m ? `${m[3]}-${m[2]}` : null;
      if (cand && cand >= '2024-01' && cand <= MES_ATUAL && !ocupado.has(`${r.empresa_id}|MUNICIPAL|${cand}`)) alvoMes = cand;
      else { skip.push({ r, motivo: `MUNICIPAL ${r.mes} ocupado e sem mês alternativo livre (1ª data: ${cand ?? 'nenhuma'})` }); continue; }
    }
    ocupado.delete(`${r.empresa_id}|FEDERAL|${r.mes}`);
    ocupado.set(`${r.empresa_id}|MUNICIPAL|${alvoMes}`, r.id);
    planos.push({ r, mes: alvoMes });
  }

  console.log(`\nFEDERAL→MUNICIPAL — modo ${APPLY ? 'APLICAR' : 'DRY-RUN'}`);
  console.log(`  a reclassificar: ${planos.length} · pulados (conflito): ${skip.length}\n`);
  for (const p of planos) console.log(`  ${p.r.arquivo_nome} : FEDERAL ${p.r.mes} -> MUNICIPAL ${p.mes}`);
  for (const s of skip) console.log(`  PULADO ${s.r.arquivo_nome} : ${s.motivo}`);

  if (!APPLY) { console.log('\nDRY-RUN. Nada gravado.'); return; }

  let ok = 0, fail = 0;
  for (const p of planos) {
    const { error } = await sb.from('checklist_cadastro').update({ certidao: 'MUNICIPAL', mes: p.mes }).eq('id', p.r.id);
    if (error) { fail++; console.error(`  FALHA ${p.r.id.slice(0, 8)}: ${error.message}`); } else ok++;
  }
  console.log(`\nFeito. Reclassificadas: ${ok} · falhas: ${fail} · puladas: ${skip.length}`);
})();
