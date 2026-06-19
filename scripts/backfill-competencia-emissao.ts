// Backfill: re-bucketiza checklist_cadastro pela data de EMISSÃO, pra ficar
// consistente com a regra nova (competência = mês de emissão lido do PDF).
//
// RE-LÊ o texto de cada PDF e usa o MESMO competenciaDoTexto da rota (só rótulos
// confiáveis — NÃO usa o emissao_em gravado pelo parser antigo, que tinha lixo do
// fallback "1ª data solta": certidão indo pra 1992, pro futuro, etc.).
//
// Regras de segurança:
//  • só mexe em linha com PDF (arquivo_url) — sem PDF, não dá pra reconfirmar a data;
//  • só move se competenciaDoTexto achar um rótulo confiável; senão deixa onde está;
//  • janela de sanidade [2025-01 .. mês atual]: fora disso vira "suspeito" e NÃO move;
//  • NÃO sobrescreve célula-alvo já ocupada por outra linha (conflito) — reporta.
//
// Uso:
//   npx tsx scripts/backfill-competencia-emissao.ts            # DRY-RUN
//   npx tsx scripts/backfill-competencia-emissao.ts --apply    # grava

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { competenciaDoTexto } from '../src/app/api/checklist-cadastro/auto-registrar/_detectar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireCJS = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfjsLib: any = requireCJS('pdfjs-dist/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

const AGORA = new Date();
const MES_ATUAL = `${AGORA.getFullYear()}-${String(AGORA.getMonth() + 1).padStart(2, '0')}`;
const MES_MIN = '2025-01';
function dentroDaJanela(m: string): boolean { return m >= MES_MIN && m <= MES_ATUAL; }

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
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('ERRO: env do Supabase faltando (.env.local)'); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function extrairTexto(buf: Buffer, maxPaginas = 3): Promise<string> {
  try {
    const data = new Uint8Array(buf);
    const doc = await pdfjsLib.getDocument({ data, useWorker: false, disableWorker: true, verbosity: 0 }).promise;
    const lim = Math.min(doc.numPages, maxPaginas);
    const partes: string[] = [];
    for (let p = 1; p <= lim; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      partes.push(content.items.map((i: { str?: string }) => i.str ?? '').join(' '));
    }
    return partes.join('\n');
  } catch { return ''; }
}

interface Row { id: string; empresa_id: string; certidao: string; mes: string; arquivo_url: string | null; }

void (async () => {
  // ── todas as linhas (pra mapear célula ocupada) ──
  const todas: Row[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await sb.from('checklist_cadastro')
      .select('id, empresa_id, certidao, mes, arquivo_url')
      .order('id', { ascending: true }).range(off, off + 999);
    if (error) { console.error('Erro lendo checklist_cadastro:', error.message); process.exit(1); }
    const lote = (data ?? []) as Row[];
    todas.push(...lote);
    if (lote.length < 1000) break;
    off += 1000; if (off > 500_000) break;
  }
  const ocupado = new Map<string, string>();
  for (const r of todas) ocupado.set(`${r.empresa_id}|${r.certidao}|${r.mes}`, r.id);

  const comPdf = todas.filter((r) => r.arquivo_url);
  console.log('');
  console.log(`Modo: ${APPLY ? 'APLICAR' : 'DRY-RUN'} · mês atual ${MES_ATUAL} · janela [${MES_MIN} .. ${MES_ATUAL}]`);
  console.log(`Linhas totais: ${todas.length} · com PDF (reconferíveis): ${comPdf.length}`);

  let lido = 0, semTexto = 0, semRotulo = 0, noLugar = 0, falhaDl = 0;
  const mover: Array<{ r: Row; to: string }> = [];
  const conflitos: Array<{ r: Row; to: string; por: string }> = [];
  const suspeitos: Array<{ r: Row; to: string }> = [];

  for (const r of comPdf) {
    let texto = '';
    try {
      const dl = await sb.storage.from('documentos').download(r.arquivo_url!);
      if (dl.error || !dl.data) { falhaDl++; continue; }
      texto = await extrairTexto(Buffer.from(await dl.data.arrayBuffer()));
    } catch { falhaDl++; continue; }
    lido++;
    if (!texto.trim()) { semTexto++; continue; }
    const to = competenciaDoTexto(texto);
    if (!to) { semRotulo++; continue; }          // sem rótulo confiável → deixa onde está
    if (to === r.mes) { noLugar++; continue; }
    if (!dentroDaJanela(to)) { suspeitos.push({ r, to }); continue; } // futuro/antigo demais → não move
    const alvo = `${r.empresa_id}|${r.certidao}|${to}`;
    const dono = ocupado.get(alvo);
    if (dono && dono !== r.id) { conflitos.push({ r, to, por: dono }); continue; }
    ocupado.delete(`${r.empresa_id}|${r.certidao}|${r.mes}`);
    ocupado.set(alvo, r.id);
    mover.push({ r, to });
    if (lido % 100 === 0) console.log(`  … lidos ${lido}/${comPdf.length}`);
  }

  console.log('\n— Plano —');
  console.log(`  PDFs lidos:                  ${lido}  (falha download: ${falhaDl}, sem texto: ${semTexto})`);
  console.log(`  sem rótulo de emissão:       ${semRotulo}  (ficam onde estão)`);
  console.log(`  já no mês certo:             ${noLugar}`);
  console.log(`  A MOVER:                     ${mover.length}`);
  console.log(`  suspeitos (fora da janela):  ${suspeitos.length}  (NÃO movidos)`);
  console.log(`  conflitos (alvo ocupado):    ${conflitos.length}  (NÃO movidos)`);

  const breakdown = new Map<string, number>();
  for (const m of mover) { const k = `${m.r.mes} -> ${m.to}`; breakdown.set(k, (breakdown.get(k) ?? 0) + 1); }
  if (breakdown.size) { console.log('\n  Moves por mês:'); for (const [k, n] of [...breakdown.entries()].sort()) console.log(`    ${k}:  ${n}`); }
  if (suspeitos.length) { console.log('\n  Suspeitos (mês fora de [2025-01..atual] — confira à mão):'); for (const s of suspeitos.slice(0, 30)) console.log(`    ${s.r.empresa_id.slice(0, 8)} · ${s.r.certidao} · ${s.r.mes} -> ${s.to}`); }
  if (conflitos.length) { console.log('\n  Conflitos:'); for (const c of conflitos.slice(0, 30)) console.log(`    ${c.r.empresa_id.slice(0, 8)} · ${c.r.certidao} · ${c.r.mes} -> ${c.to} (ocupado por ${c.por.slice(0, 8)})`); }

  if (!APPLY) { console.log('\nDRY-RUN. Nada gravado. Rode com --apply pra mover.'); return; }

  console.log(`\nAplicando ${mover.length} move(s)…`);
  let ok = 0, fail = 0;
  for (const m of mover) {
    const { error } = await sb.from('checklist_cadastro').update({ mes: m.to }).eq('id', m.r.id);
    if (error) { fail++; if (fail <= 20) console.error(`  FALHA ${m.r.id.slice(0, 8)} (${m.r.mes}->${m.to}): ${error.message}`); }
    else ok++;
  }
  console.log(`\nFeito. Movidas: ${ok} · falhas: ${fail} · suspeitos deixados: ${suspeitos.length} · conflitos deixados: ${conflitos.length}`);
})();
