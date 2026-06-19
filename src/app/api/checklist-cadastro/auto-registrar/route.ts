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
import { certidaoDoArquivo, tipoDoTexto, resultadoDoTexto, resultadoDoNome, emissaoDoTexto, competenciaDoTexto, cnpjBaseDoTexto, extrairDetalhesCertidao } from './_detectar';
import { autoEnviarCertidao, type AutoEnvioResultado } from './_auto-enviar';
import { resolveBaseUrl } from '../_pixel';
import { ufDaEmpresa } from '@/app/utils/certidoes';
import { criarNotificacaoSistema, resolverDestinatariosCadastro, rotuloProblemaCadastro, severidadeDoProblema } from '@/lib/alertasAutoEnvio';
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

// Retorna true se o problema é NOVO (não existia esse arquivo/hash) — usado pra
// disparar o aviso no sino só uma vez por arquivo.
async function registrarProblema(admin: SupabaseClient, p: {
  caminhoServidor: string; nomeArquivo: string; hashArquivo: string; empresaId: string | null;
  tipoProblema: string; detalhes: Record<string, unknown>;
  competenciaParseada: string | null; certidaoParseada: string | null; resultadoParseado: string | null;
}): Promise<boolean> {
  const { data: existente } = await admin.from('certidoes_auto_problemas')
    .select('id').eq('caminho_servidor', p.caminhoServidor).eq('hash_arquivo', p.hashArquivo).maybeSingle();
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
  return !existente;
}

// Aviso no sino pras meninas do cadastro: certidão não processada + o motivo.
// Respeita o modo-teste do alertasAutoEnvio (vai pro usuário Testes enquanto valida).
async function notificarProblemaCadastro(admin: SupabaseClient, p: {
  nomeArquivo: string; tipoProblema: string; motivo: string; empresaId: string | null;
}): Promise<void> {
  try {
    const dest = await resolverDestinatariosCadastro(admin);
    if (dest.length === 0) return;
    await criarNotificacaoSistema(admin, {
      titulo: 'Certidão não processada',
      mensagem: `${p.nomeArquivo}: ${rotuloProblemaCadastro(p.tipoProblema)}. ${p.motivo} (foi pra pasta _PENDENTES)`,
      tipo: severidadeDoProblema(p.tipoProblema),
      empresaId: p.empresaId,
      destinatarios: dest.map((u) => u.id),
    });
  } catch (e) {
    console.error('[auto-registrar] falha ao notificar problema:', e instanceof Error ? e.message : e);
  }
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
  let meta: { caminhoServidor?: string; hash?: string; mes?: string; subpasta?: string; autoEnviar?: boolean };
  try { meta = JSON.parse(metaRaw); }
  catch { return NextResponse.json({ status: 'erro', detalhes: { motivo: 'meta não é JSON' } }, { status: 400 }); }
  if (!meta.caminhoServidor || !meta.mes || !/^\d{4}-\d{2}$/.test(meta.mes)) {
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'meta.caminhoServidor e meta.mes (YYYY-MM) obrigatórios' } }, { status: 400 });
  }

  const caminhoServidor = meta.caminhoServidor;
  const nomeArquivo = nomeDoCaminho(caminhoServidor);
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const hashArquivo = createHash('sha256').update(fileBuffer).digest('hex');
  if (meta.hash && meta.hash !== hashArquivo) {
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'Hash divergente' } }, { status: 400 });
  }

  // 3. (Idempotência movida pra DEPOIS de identificar empresa+certidão — ver 7b.)
  //    O dedup por hash sozinho pulava e deixava a célula SEM anexo quando o PDF
  //    não estava lá (anexo removido, ou célula só com resultado da relação).

  // 4. Texto do PDF (base da identificação por conteúdo)
  let texto = '';
  try { texto = await extrairTextoPdfServidor(fileBuffer); } catch { texto = ''; }

  // Competência = mês da EMISSÃO lida do PDF (a certidão cai no mês em que foi
  // emitida — ex.: Trabalhista expedida 14/05 → maio; Estadual MG 06/06 → junho).
  // Sem emissão reconhecida no texto, cai no mês do run (meta.mes).
  const emissao = emissaoDoTexto(texto);
  const mes = competenciaDoTexto(texto) ?? meta.mes;

  // 5. Certidão: 1º pelo TOKEN do nome (formato antigo cnd-*), senão pelo TEXTO
  //    (pastas renomeadas: "Certidão Negativa - CNPJ X.pdf", "HEDRONS P.E.N.pdf").
  const det = certidaoDoArquivo(nomeArquivo, meta.subpasta) ?? tipoDoTexto(texto);
  if (!det) {
    const motivo = 'Não reconheci o tipo de certidão (nem pelo nome nem pelo texto do PDF).';
    const novo = await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo, empresaId: null,
      tipoProblema: 'certidao_desconhecida',
      detalhes: { motivo, subpasta: meta.subpasta ?? null },
      competenciaParseada: mes, certidaoParseada: null, resultadoParseado: null,
    });
    await registrarProcessado(admin, { caminhoServidor, hashArquivo, empresaId: null, competencia: mes, certidao: null, resultado: null, nomeArquivo, status: 'pendente_correcao', detalhes: { tipoProblema: 'certidao_desconhecida' } });
    if (novo) await notificarProblemaCadastro(admin, { nomeArquivo, tipoProblema: 'certidao_desconhecida', motivo, empresaId: null });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'certidao_desconhecida' } });
  }

  // 6. Empresa: 1º pelo texto (CNPJ/IE forte, nome fraco). Fallback: CNPJ no NOME
  //    do arquivo (formato novo "… - CNPJ 08876977000189.pdf").
  const { data: empresasRows } = await admin.from('empresas').select('*').is('desligada_em', null);
  const todasEmpresas = (empresasRows ?? []) as Empresa[];
  const identEmpresa = identificarEmpresa(texto, todasEmpresas);
  let empresa = identEmpresa.empresa;
  let tipoMatch: string | null = identEmpresa.tipoMatch;
  let forte = identEmpresa.forte;
  if (!empresa) {
    const tokens = nomeArquivo.match(/\d[\d.\-/]{12,17}\d/g) ?? [];
    let cnpjNome: string | null = null;
    for (const tok of tokens) { const d = tok.replace(/\D/g, ''); if (d.length === 14) { cnpjNome = d; break; } }
    if (cnpjNome) {
      const achada = todasEmpresas.find((e) => (e.cnpj ?? '').replace(/\D/g, '') === cnpjNome);
      if (achada) { empresa = achada; tipoMatch = 'cnpj_nome_arquivo'; forte = true; }
    }
  }
  // Fallback 3: certidões com só o CNPJ BASE (ex.: Dívida Ativa SP). Casa pela
  // raiz; se houver mais de um estabelecimento da mesma raiz, desempata pela UF
  // da certidão (debitsp/sefazsp → SP). Só aceita se sobrar exatamente UMA.
  if (!empresa && (det.certidao === 'ESTADUAL_DA' || det.certidao === 'ESTADUAL_ADM')) {
    const base = cnpjBaseDoTexto(texto);
    if (base) {
      let cands = todasEmpresas.filter((e) => (e.cnpj ?? '').replace(/\D/g, '').slice(0, 8) === base);
      if (det.uf && cands.length > 1) {
        const porUf = cands.filter((e) => ufDaEmpresa(e) === det.uf);
        if (porUf.length) cands = porUf;
      }
      if (cands.length === 1) { empresa = cands[0]; tipoMatch = 'cnpj_base_uf'; forte = false; }
    }
  }
  if (!empresa) {
    const tipoProblema = identEmpresa.ambiguo ? 'empresa_ambigua' : 'empresa_nao_encontrada';
    const motivo = identEmpresa.ambiguo ? 'Mais de uma empresa casou com o PDF.' : 'Nenhuma empresa reconhecida no PDF nem no nome.';
    const novo = await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo, empresaId: null, tipoProblema,
      detalhes: { motivo, certidao: det.certidao },
      competenciaParseada: mes, certidaoParseada: det.certidao, resultadoParseado: null,
    });
    await registrarProcessado(admin, { caminhoServidor, hashArquivo, empresaId: null, competencia: mes, certidao: det.certidao, resultado: null, nomeArquivo, status: 'pendente_correcao', detalhes: { tipoProblema } });
    if (novo) await notificarProblemaCadastro(admin, { nomeArquivo, tipoProblema, motivo, empresaId: null });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema, certidao: det.certidao } });
  }

  // 7. Resultado: texto do PDF; reforço pelo nome do arquivo. (Emissão/competência
  //    já calculadas no passo 4.)
  const resultado = resultadoDoTexto(texto) ?? resultadoDoNome(nomeArquivo);

  // Auto-envio (opt-in via --auto-enviar). Best-effort — falha aqui NÃO reverte o
  // registro/anexo. Travas (Positiva, e-mail de cadastro, dedup) ficam dentro.
  const tentarAutoEnvio = async (): Promise<AutoEnvioResultado | undefined> => {
    if (!meta.autoEnviar) return undefined;
    const ghostId = process.env.GHOST_USER_ID;
    if (!ghostId) return { enviou: false, motivo: 'ghost_sem_gmail' };
    try {
      return await autoEnviarCertidao(admin, { empresa, certidao: det.certidao, mes, resultado, arquivoNome: nomeArquivo, fileBuffer, ghostUserId: ghostId, baseUrl: resolveBaseUrl(req) });
    } catch (e) { return { enviou: false, motivo: 'erro_envio', erro: e instanceof Error ? e.message : 'erro' }; }
  };

  // 7b. Idempotência ESPERTA: só pula se ESTA célula já tem ESTE mesmo arquivo
  //     anexado (mesmo hash). Se a célula está SEM o PDF (anexo removido, ou só
  //     tinha resultado da relação), NÃO pula — segue e re-anexa. Conserta o
  //     "reconheceu mas não anexou".
  const { data: cellAtual } = await admin
    .from('checklist_cadastro')
    .select('arquivo_url, arquivo_hash')
    .eq('empresa_id', empresa.id).eq('certidao', det.certidao).eq('mes', mes)
    .maybeSingle();
  const jaAnexada = cellAtual
    && (cellAtual as { arquivo_url?: string | null }).arquivo_url
    && (cellAtual as { arquivo_hash?: string | null }).arquivo_hash === hashArquivo;
  if (jaAnexada) {
    await registrarProcessado(admin, { caminhoServidor, hashArquivo, empresaId: empresa.id, competencia: mes, certidao: det.certidao, resultado, nomeArquivo, status: 'ja_processado', detalhes: { motivo: 'célula já tem este arquivo anexado' } });
    // Mesmo já anexada, tenta enviar (o dedup interno evita reenvio).
    const autoEnvio = await tentarAutoEnvio();
    return NextResponse.json({ status: 'ja_processado', empresa: { id: empresa.id, nome: empresa.apelido || empresa.razao_social || empresa.codigo }, certidao: det.certidao, autoEnvio });
  }

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
  // Gestão de Certidões: validade/número/órgão/autenticidade lidos do texto.
  const detalhes = extrairDetalhesCertidao(texto, det.certidao, emissao);
  if (detalhes.validadeEm) row.validade_em = detalhes.validadeEm;
  if (detalhes.numeroCertidao) row.numero_certidao = detalhes.numeroCertidao;
  if (detalhes.orgaoEmissor) row.orgao_emissor = detalhes.orgaoEmissor;
  if (detalhes.codigoAutenticidade) row.codigo_autenticidade = detalhes.codigoAutenticidade;
  if (detalhes.linkValidacao) row.link_validacao = detalhes.linkValidacao;
  let { error: upsertErr } = await admin
    .from('checklist_cadastro')
    .upsert(row, { onConflict: 'empresa_id,certidao,mes' });
  // Fallback: migration da Gestão ainda não rodou (colunas novas ausentes) —
  // grava sem elas pra não travar o watcher.
  if (upsertErr && /validade_em|numero_certidao|orgao_emissor|codigo_autenticidade|link_validacao|column/i.test(upsertErr.message ?? '')) {
    console.warn('[auto-registrar] colunas da Gestão ausentes — rode supabase-migration-gestao-certidoes.sql. Gravando sem elas.');
    for (const k of ['validade_em', 'numero_certidao', 'orgao_emissor', 'codigo_autenticidade', 'link_validacao']) delete row[k];
    const retry = await admin.from('checklist_cadastro').upsert(row, { onConflict: 'empresa_id,certidao,mes' });
    upsertErr = retry.error;
  }
  if (upsertErr) {
    await registrarProcessado(admin, { caminhoServidor, hashArquivo, empresaId: empresa.id, competencia: mes, certidao: det.certidao, resultado, nomeArquivo, status: 'erro', detalhes: { motivo: 'falha no upsert', erro: upsertErr.message } });
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'Falha ao gravar o checklist', erro: upsertErr.message } }, { status: 500 });
  }

  // 10. Registra processado (sucesso). Se resultado indefinido, anota problema leve.
  await registrarProcessado(admin, {
    caminhoServidor, hashArquivo, empresaId: empresa.id, competencia: mes,
    certidao: det.certidao, resultado, nomeArquivo, status: 'registrado',
    detalhes: { uf: det.uf, autoridade: det.autoridade, emissao, tipoMatch, forte },
  });
  if (!resultado) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo, empresaId: empresa.id,
      tipoProblema: 'resultado_indefinido',
      detalhes: { motivo: 'Registrei a certidão, mas não classifiquei o resultado (Neg/Pos/PEN) pelo texto. Defina manualmente.' },
      competenciaParseada: mes, certidaoParseada: det.certidao, resultadoParseado: null,
    });
  }

  const autoEnvio = await tentarAutoEnvio();

  return NextResponse.json({
    status: 'registrado',
    empresa: { id: empresa.id, nome: empresa.apelido || empresa.razao_social || empresa.codigo },
    certidao: det.certidao,
    uf: det.uf,
    resultado,
    emissao,
    mes,
    matchFraco: !forte,
    autoEnvio,
  });
}
