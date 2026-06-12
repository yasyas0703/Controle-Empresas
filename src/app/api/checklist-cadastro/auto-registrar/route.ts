// Endpoint chamado pelo watcher de CERTIDÕES (scripts/watcher-certidoes.mjs).
// Lê o PDF, identifica empresa (CNPJ/IE/nome — reusa o identificarEmpresa do
// fiscal), a certidão (token do nome do arquivo), o resultado (texto) e a data
// de emissão; faz upload no Storage e grava/atualiza a célula do checklist_cadastro.
//
// IMPORTANTE: NÃO envia e-mail. Só REGISTRA no sistema. O envio ao cliente
// continua manual (página Controle Cadastro) — o watcher só lê e cataloga.
// Idempotência por hash em certidoes_auto_processadas.

import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin, extrairTextoPdfServidor } from '../../checklist-fiscal/_shared';
import { identificarEmpresa } from '../../checklist-fiscal/auto-enviar/_identificar';
import { certidaoDoArquivo, resultadoDoTexto, emissaoDoTexto } from './_detectar';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Empresa } from '@/app/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BUCKET = 'documentos';

function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function nomeDoCaminho(caminho: string): string {
  const partes = caminho.split(/[\\/]+/);
  return partes[partes.length - 1] || caminho;
}

async function registrarProcessado(admin: SupabaseClient, p: {
  caminhoServidor: string; hashArquivo: string; empresaId: string | null;
  competencia: string | null; certidao: string | null; resultado: string | null;
  nomeArquivo: string; status: string; detalhes: Record<string, unknown>;
}): Promise<void> {
  await admin.from('certidoes_auto_processadas').upsert({
    caminho_servidor: p.caminhoServidor,
    hash_arquivo: p.hashArquivo,
    empresa_id: p.empresaId,
    competencia: p.competencia,
    certidao: p.certidao,
    resultado: p.resultado,
    nome_arquivo: p.nomeArquivo,
    status: p.status,
    detalhes: p.detalhes,
    processado_em: new Date().toISOString(),
  }, { onConflict: 'caminho_servidor,hash_arquivo' }).then(() => undefined, (e) => console.error('[auto-registrar] processadas:', e));
}

async function registrarProblema(admin: SupabaseClient, p: {
  caminhoServidor: string; nomeArquivo: string; hashArquivo: string; empresaId: string | null;
  tipoProblema: string; detalhes: Record<string, unknown>;
  competenciaParseada: string | null; certidaoParseada: string | null; resultadoParseado: string | null;
}): Promise<void> {
  await admin.from('certidoes_auto_problemas').upsert({
    caminho_servidor: p.caminhoServidor,
    nome_arquivo: p.nomeArquivo,
    hash_arquivo: p.hashArquivo,
    empresa_id: p.empresaId,
    tipo_problema: p.tipoProblema,
    detalhes: p.detalhes,
    competencia_parseada: p.competenciaParseada,
    certidao_parseada: p.certidaoParseada,
    resultado_parseado: p.resultadoParseado,
    criado_em: new Date().toISOString(),
  }, { onConflict: 'caminho_servidor,hash_arquivo' }).then(() => undefined, (e) => console.error('[auto-registrar] problemas:', e));
}

export async function POST(req: Request) {
  // 1. Auth via machine token (mesmo token do auto-envio fiscal)
  const expectedToken = process.env.AUTO_ENVIO_TOKEN;
  if (!expectedToken) return NextResponse.json({ status: 'erro', detalhes: { motivo: 'AUTO_ENVIO_TOKEN não configurado' } }, { status: 500 });
  const headerToken = req.headers.get('x-machine-token') || '';
  if (!headerToken || !tokensIguais(headerToken, expectedToken)) {
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'Token inválido' } }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  // 2. Multipart
  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ status: 'erro', detalhes: { motivo: 'multipart inválido' } }, { status: 400 }); }
  const file = formData.get('arquivo');
  const metaRaw = formData.get('meta');
  if (!(file instanceof File) || typeof metaRaw !== 'string') {
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'Payload inválido (arquivo + meta)' } }, { status: 400 });
  }
  let meta: { caminhoServidor?: string; hash?: string; mes?: string; subpasta?: string };
  try { meta = JSON.parse(metaRaw); }
  catch { return NextResponse.json({ status: 'erro', detalhes: { motivo: 'meta não é JSON' } }, { status: 400 }); }
  if (!meta.caminhoServidor || !meta.mes || !/^\d{4}-\d{2}$/.test(meta.mes)) {
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'meta.caminhoServidor e meta.mes (YYYY-MM) obrigatórios' } }, { status: 400 });
  }

  const caminhoServidor = meta.caminhoServidor;
  const mes = meta.mes;
  const nomeArquivo = nomeDoCaminho(caminhoServidor);
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const hashArquivo = createHash('sha256').update(fileBuffer).digest('hex');
  if (meta.hash && meta.hash !== hashArquivo) {
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'Hash divergente' } }, { status: 400 });
  }

  // 3. Idempotência por hash (status terminal 'registrado')
  const { data: jaProcessado } = await admin
    .from('certidoes_auto_processadas')
    .select('id, status, processado_em')
    .eq('hash_arquivo', hashArquivo)
    .eq('status', 'registrado')
    .order('processado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jaProcessado) {
    return NextResponse.json({ status: 'ja_processado', detalhes: { processadoEm: (jaProcessado as { processado_em?: string }).processado_em } });
  }

  // 4. Certidão pelo nome do arquivo (+ dica de subpasta)
  const det = certidaoDoArquivo(nomeArquivo, meta.subpasta);
  if (!det) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo, empresaId: null,
      tipoProblema: 'certidao_desconhecida',
      detalhes: { motivo: 'Não reconheci o tipo de certidão pelo nome do arquivo.', subpasta: meta.subpasta ?? null },
      competenciaParseada: mes, certidaoParseada: null, resultadoParseado: null,
    });
    await registrarProcessado(admin, { caminhoServidor, hashArquivo, empresaId: null, competencia: mes, certidao: null, resultado: null, nomeArquivo, status: 'pendente_correcao', detalhes: { tipoProblema: 'certidao_desconhecida' } });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'certidao_desconhecida' } });
  }

  // 5. Texto do PDF
  let texto = '';
  try { texto = await extrairTextoPdfServidor(fileBuffer); } catch { texto = ''; }

  // 6. Empresa (reusa o identificador do fiscal: CNPJ/IE forte, nome fraco)
  const { data: empresasRows } = await admin.from('empresas').select('*').is('desligada_em', null);
  const todasEmpresas = (empresasRows ?? []) as Empresa[];
  const identEmpresa = identificarEmpresa(texto, todasEmpresas);
  if (!identEmpresa.empresa) {
    const tipoProblema = identEmpresa.ambiguo ? 'empresa_ambigua' : 'empresa_nao_encontrada';
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo, empresaId: null, tipoProblema,
      detalhes: { motivo: identEmpresa.ambiguo ? 'Mais de uma empresa casou com o PDF.' : 'Nenhuma empresa reconhecida no PDF.', certidao: det.certidao },
      competenciaParseada: mes, certidaoParseada: det.certidao, resultadoParseado: null,
    });
    await registrarProcessado(admin, { caminhoServidor, hashArquivo, empresaId: null, competencia: mes, certidao: det.certidao, resultado: null, nomeArquivo, status: 'pendente_correcao', detalhes: { tipoProblema } });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema, certidao: det.certidao } });
  }
  const empresa = identEmpresa.empresa;

  // 7. Resultado + emissão (texto)
  const resultado = resultadoDoTexto(texto);
  const emissao = emissaoDoTexto(texto);

  // 8. Upload do PDF (path determinístico por hash → idempotente)
  const certSlug = det.certidao.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const path = `empresas/${empresa.id}/cadastro/${mes}/${certSlug}-${hashArquivo.slice(0, 16)}.pdf`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, fileBuffer, { contentType: 'application/pdf', upsert: true });
  if (upErr) {
    await registrarProcessado(admin, { caminhoServidor, hashArquivo, empresaId: empresa.id, competencia: mes, certidao: det.certidao, resultado, nomeArquivo, status: 'erro', detalhes: { motivo: 'falha no upload', erro: upErr.message } });
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'Falha no upload do PDF', erro: upErr.message } }, { status: 500 });
  }

  // 9. Upsert da célula do checklist (preserva relatório/observação/status manual
  //    — só seta os campos da certidão). onConflict (empresa_id, certidao, mes).
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    empresa_id: empresa.id,
    certidao: det.certidao,
    mes,
    arquivo_url: path,
    arquivo_nome: nomeArquivo,
    arquivo_hash: hashArquivo,
    uf: det.uf,
    autoridade: det.autoridade,
    fonte: 'watcher',
    atualizado_em: now,
  };
  if (resultado) row.resultado = resultado;
  if (emissao) row.emissao_em = emissao;
  const { error: upsertErr } = await admin
    .from('checklist_cadastro')
    .upsert(row, { onConflict: 'empresa_id,certidao,mes' });
  if (upsertErr) {
    await registrarProcessado(admin, { caminhoServidor, hashArquivo, empresaId: empresa.id, competencia: mes, certidao: det.certidao, resultado, nomeArquivo, status: 'erro', detalhes: { motivo: 'falha no upsert', erro: upsertErr.message } });
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'Falha ao gravar o checklist', erro: upsertErr.message } }, { status: 500 });
  }

  // 10. Registra processado (sucesso). Se resultado indefinido, anota problema leve.
  await registrarProcessado(admin, {
    caminhoServidor, hashArquivo, empresaId: empresa.id, competencia: mes,
    certidao: det.certidao, resultado, nomeArquivo, status: 'registrado',
    detalhes: { uf: det.uf, autoridade: det.autoridade, emissao, tipoMatch: identEmpresa.tipoMatch, forte: identEmpresa.forte },
  });
  if (!resultado) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo, empresaId: empresa.id,
      tipoProblema: 'resultado_indefinido',
      detalhes: { motivo: 'Registrei a certidão, mas não classifiquei o resultado (Neg/Pos/PEN) pelo texto. Defina manualmente.' },
      competenciaParseada: mes, certidaoParseada: det.certidao, resultadoParseado: null,
    });
  }

  return NextResponse.json({
    status: 'registrado',
    empresa: { id: empresa.id, nome: empresa.apelido || empresa.razao_social || empresa.codigo },
    certidao: det.certidao,
    uf: det.uf,
    resultado,
    emissao,
    mes,
    matchFraco: !identEmpresa.forte,
  });
}
