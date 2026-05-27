// Endpoint chamado pelo daemon local que olha a pasta T:/Fiscal/EMPRESA/.../*.pdf.
//
// Diferenças do `enviar-anexo`:
//   - Auth via header `X-Machine-Token` (env `AUTO_ENVIO_TOKEN`), não cookie de sessão
//   - Envio sai do Gmail do GHOST_USER_ID (não há "usuária logada")
//   - Resolução de empresa, parser de nome e validações geram entradas em
//     `guias_auto_problemas` em vez de erro pro cliente — daemon não tem
//     UI pra resolver, então o problema fica no dashboard
//   - Idempotência por (caminho_servidor + hash_arquivo) em `guias_auto_processadas`
//   - Modo conservador: 1ª vez de cada (empresa + obrigação) NÃO envia automaticamente,
//     deixa pendente de aprovação pra Yasmin liberar manualmente
//
// O que NÃO duplica de `enviar-anexo`: a função `enviarGuiaPorGmail` mora aqui
// porque tem ajustes (sem checklistId obrigatório, etc). Quando estiver tudo
// testado, podemos refatorar pra um core compartilhado em _shared.ts.

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { getOAuthClient, decryptToken } from '@/lib/googleOAuth';
import { sendPushToCliente } from '@/lib/webPush';
import { vencimentoDoMes, vencimentoDoMesSn } from '@/app/utils/regrasVencimentosFiscais';
import {
  validarPdfNoServidor, carregarEmpresaCompleta, getSupabaseAdmin, isErroApi,
} from '../_shared';
import {
  parseNomeGuia, extrairNomeEmpresaDoCaminho, detectarRegimeDoCaminho,
  type ResultadoParseNome,
} from '@/lib/parseNomeGuia';
import { basename } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Empresa } from '@/app/types';

export const runtime = 'nodejs';
// Body limite — guias passam de 1MB em casos raros (DARFs com gráfico). Generoso.
export const maxDuration = 60;

const BUCKET_DOCUMENTOS = 'documentos';
const BUCKET_PORTAL = 'portal-documentos';

// ─── Tipos do retorno ──────────────────────────────────────────────────────
type StatusProcessamento =
  | 'enviado'                              // tudo certo, email saiu
  | 'ja_processado'                        // hash+caminho já existem em processadas
  | 'pendente_correcao'                    // problema registrado pra admin resolver
  | 'pendente_aprovacao_primeira_vez'      // modo conservador: 1ª vez, espera aprovação
  | 'pendente_aprovacao_competencia_antiga' // competência > 60 dias atrás
  | 'duplicado_periodo'                    // envio anterior dessa empresa+mes+obrigacao no checklist
  | 'interno_marcado_feito'                // obrigação tipo "não envia cliente" — só marca check
  | 'erro';

// Quantos dias atrás é "competência antiga" — não envia automaticamente,
// pede aprovação manual no widget. Evita mandar email "Sua guia de Março/2025"
// pro cliente em Maio/2026 quando alguém sobe PDF retroativo na pasta.
const MAX_DIAS_COMPETENCIA_AUTOMATICA = 60;

function competenciaEhRecente(competencia: string): boolean {
  // competencia = "YYYY-MM". Considera o último dia do mês como referência.
  const [y, m] = competencia.split('-').map(Number);
  if (!y || !m) return false;
  // último dia do mês da competência (dia 0 do mês seguinte = último do anterior)
  const fimDoMesCompetencia = new Date(Date.UTC(y, m, 0));
  const hoje = new Date();
  const diffMs = hoje.getTime() - fimDoMesCompetencia.getTime();
  const diffDias = diffMs / (1000 * 60 * 60 * 24);
  return diffDias <= MAX_DIAS_COMPETENCIA_AUTOMATICA;
}

interface RespostaAuto {
  status: StatusProcessamento;
  detalhes: Record<string, unknown>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Compara duas strings de token em tempo constante (evita timing attack).
 * Retorna false se tamanhos diferentes — não vaza info.
 */
function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Strip CRLF — defesa contra header injection (atacante podia setar
// razao_social com `\r\nBcc: evil@x.com` e injetar Bcc no email).
function stripCrlf(text: string): string {
  return text.replace(/[\r\n]/g, ' ').trim();
}

function encodeRfc2047(text: string): string {
  const safe = stripCrlf(text);
  if (/^[\x00-\x7F]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

// Sanitiza filename pra header MIME: remove CRLF (header injection) +
// remove aspas duplas (`"`) que fechariam o atributo `filename="..."`.
function sanitizeMimeFilename(name: string): string {
  return stripCrlf(name).replace(/"/g, '');
}

function mimeTypeFromFilename(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

function formatComp(iso?: string | null): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${meses[Number(m)]}/${y}`;
}

function buildMime(params: {
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachment: { filename: string; mime: string; content: Buffer };
}): string {
  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const altBoundary = `----=_Alt_${Math.random().toString(36).slice(2)}_${Date.now()}`;

  const headers = [
    `From: ${stripCrlf(params.from)}`,
    `To: ${params.to.map(stripCrlf).join(', ')}`,
    `Subject: ${encodeRfc2047(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join('\r\n');

  const altPart = [
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.bodyText, 'utf8').toString('base64'),
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.bodyHtml, 'utf8').toString('base64'),
    '',
    `--${altBoundary}--`,
  ].join('\r\n');

  const attachmentB64 = params.attachment.content.toString('base64');
  const attachmentB64Wrapped = attachmentB64.match(/.{1,76}/g)?.join('\r\n') ?? attachmentB64;
  const safeFilename = sanitizeMimeFilename(params.attachment.filename);
  const safeMime = stripCrlf(params.attachment.mime);
  const attPart = [
    `--${boundary}`,
    `Content-Type: ${safeMime}; name="${safeFilename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    '',
    attachmentB64Wrapped,
  ].join('\r\n');

  return [headers, '', altPart, '', attPart, '', `--${boundary}--`].join('\r\n');
}

/**
 * Normalização forte usada pra match de nome de empresa (pasta T: vs cadastro).
 * Tira: ltda/me/sa/eireli/epp, acentos, pontuação, espaços extras.
 */
function normalizarNomeEmpresa(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bltda\b|\bme\b|\bs\.?a\.?\b|\beireli\b|\beirelli\b|\bepp\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Tenta achar a empresa pelo nome bruto da pasta no T:.
 *
 * Estratégia:
 *   1. Match exato em apelido normalizado
 *   2. Match exato em razão social normalizada
 *   3. Match exato em "código" (se a pasta for o código)
 *
 * Se houver múltiplos matches, retorna ambíguo → vira problema "empresa_nao_encontrada"
 * (admin precisa cadastrar apelido único ou corrigir nome da pasta).
 */
async function resolverEmpresaPorNomePasta(
  admin: SupabaseClient,
  nomePasta: string,
): Promise<{ empresa: Empresa } | { erro: 'nao_encontrada' | 'ambigua'; candidatos?: string[] }> {
  const normPasta = normalizarNomeEmpresa(nomePasta);
  if (!normPasta) return { erro: 'nao_encontrada' };

  const { data, error } = await admin
    .from('empresas')
    .select('*');

  if (error || !data) return { erro: 'nao_encontrada' };

  const matches: Empresa[] = [];
  for (const row of data as Empresa[]) {
    const apelido = normalizarNomeEmpresa(row.apelido ?? '');
    const razao = normalizarNomeEmpresa(row.razao_social ?? '');
    const codigo = normalizarNomeEmpresa(row.codigo ?? '');
    if (apelido === normPasta || razao === normPasta || codigo === normPasta) {
      matches.push(row);
    }
  }

  if (matches.length === 0) return { erro: 'nao_encontrada' };
  if (matches.length > 1) {
    return {
      erro: 'ambigua',
      candidatos: matches.map((m) => `${m.codigo ?? '?'} - ${m.razao_social ?? m.apelido}`),
    };
  }

  // Empresa achada — recarrega "completa" pra ter vencimentos_fiscais formatados
  const completa = await carregarEmpresaCompleta(admin, matches[0].id);
  if (isErroApi(completa)) return { erro: 'nao_encontrada' };
  return { empresa: completa };
}

/**
 * Verifica se já houve algum envio (em qualquer mês) dessa combinação empresa
 * + obrigação. Usado pelo modo conservador "1ª vez precisa aprovação".
 *
 * Conta tanto envios manuais (pela aba Envio) quanto automáticos. A intenção
 * é: assim que QUALQUER envio dessa combinação tiver acontecido com sucesso,
 * próximos podem ser automáticos.
 */
async function jaTeveEnvioSucesso(
  admin: SupabaseClient,
  empresaId: string,
  obrigacao: string,
): Promise<boolean> {
  // 1. Olha histórico em checklist_fiscal (envios manuais e automáticos)
  const { data: checklists } = await admin
    .from('checklist_fiscal')
    .select('envios_historico')
    .eq('empresa_id', empresaId)
    .eq('obrigacao', obrigacao);

  if (checklists && checklists.length > 0) {
    for (const c of checklists as Array<{ envios_historico?: Array<{ sucesso?: boolean }> | null }>) {
      const envios = c.envios_historico ?? [];
      if (envios.some((e) => e?.sucesso === true)) return true;
    }
  }

  // 2. Olha guias_auto_processadas (status enviado)
  const { count } = await admin
    .from('guias_auto_processadas')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
    .eq('obrigacao', obrigacao)
    .eq('status', 'enviado');

  return (count ?? 0) > 0;
}

/**
 * Upsert em guias_auto_problemas (idempotente por caminho+hash).
 * Se o problema já existe pro mesmo arquivo, atualiza detalhes.
 */
async function registrarProblema(
  admin: SupabaseClient,
  payload: {
    caminhoServidor: string;
    nomeArquivo: string;
    hashArquivo: string;
    empresaId: string | null;
    empresaNomePasta: string | null;
    tipoProblema: string;
    detalhes: Record<string, unknown>;
    competenciaParseada: string | null;
    obrigacaoParseada: string | null;
  },
): Promise<void> {
  await admin
    .from('guias_auto_problemas')
    .upsert(
      {
        caminho_servidor: payload.caminhoServidor,
        nome_arquivo: payload.nomeArquivo,
        hash_arquivo: payload.hashArquivo,
        empresa_id: payload.empresaId,
        empresa_nome_pasta: payload.empresaNomePasta,
        tipo_problema: payload.tipoProblema,
        detalhes: payload.detalhes,
        competencia_parseada: payload.competenciaParseada,
        obrigacao_parseada: payload.obrigacaoParseada,
        // Se está reabrindo o mesmo problema, zera resolução anterior
        resolvido_em: null,
        resolvido_por_id: null,
        resolvido_por_nome: null,
        resolucao: null,
      },
      { onConflict: 'caminho_servidor,hash_arquivo' },
    )
    .then(
      () => undefined,
      (err) => console.error('[auto-enviar] falha ao registrar problema:', err),
    );
}

/**
 * Insert em guias_auto_processadas (idempotente por caminho+hash).
 * Se já existe, atualiza status e processado_em.
 */
async function registrarProcessado(
  admin: SupabaseClient,
  payload: {
    caminhoServidor: string;
    hashArquivo: string;
    empresaId: string | null;
    competencia: string | null;
    obrigacao: string | null;
    nomeArquivo: string;
    status: StatusProcessamento;
    detalhes: Record<string, unknown>;
  },
): Promise<void> {
  await admin
    .from('guias_auto_processadas')
    .upsert(
      {
        caminho_servidor: payload.caminhoServidor,
        hash_arquivo: payload.hashArquivo,
        empresa_id: payload.empresaId,
        competencia: payload.competencia,
        obrigacao: payload.obrigacao,
        nome_arquivo: payload.nomeArquivo,
        status: payload.status,
        detalhes: payload.detalhes,
        processado_em: new Date().toISOString(),
      },
      { onConflict: 'caminho_servidor,hash_arquivo' },
    )
    .then(
      () => undefined,
      (err) => console.error('[auto-enviar] falha ao registrar processado:', err),
    );
}

// ─── Handler principal ─────────────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Auth via machine token
  const expectedToken = process.env.AUTO_ENVIO_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'AUTO_ENVIO_TOKEN não configurado no servidor' } },
      { status: 500 },
    );
  }
  const headerToken = req.headers.get('x-machine-token') || '';
  if (!headerToken || !tokensIguais(headerToken, expectedToken)) {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'Token inválido' } },
      { status: 401 },
    );
  }

  const ghostUserId = process.env.GHOST_USER_ID;
  if (!ghostUserId) {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'GHOST_USER_ID não configurado no servidor' } },
      { status: 500 },
    );
  }

  // 2. Parse multipart
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'Não foi possível ler o multipart' } },
      { status: 400 },
    );
  }

  const file = formData.get('arquivo');
  const metaRaw = formData.get('meta');
  if (!(file instanceof File) || typeof metaRaw !== 'string') {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'Payload inválido (arquivo + meta)' } },
      { status: 400 },
    );
  }

  let meta: { caminhoServidor?: string; hash?: string };
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'meta não é JSON válido' } },
      { status: 400 },
    );
  }
  if (!meta.caminhoServidor) {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'meta.caminhoServidor obrigatório' } },
      { status: 400 },
    );
  }

  const caminhoServidor = meta.caminhoServidor;
  const nomeArquivo = basename(caminhoServidor);
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  // 3. Hash do arquivo (confere com o que o daemon mandou; recalcula pra garantir)
  const hashCalculado = createHash('sha256').update(fileBuffer).digest('hex');
  if (meta.hash && meta.hash !== hashCalculado) {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'Hash divergente entre daemon e servidor' } },
      { status: 400 },
    );
  }
  const hashArquivo = hashCalculado;

  const admin = getSupabaseAdmin();

  // 4. Idempotência: já foi processado esse arquivo nesse caminho?
  const { data: jaProcessado } = await admin
    .from('guias_auto_processadas')
    .select('id, status, processado_em')
    .eq('caminho_servidor', caminhoServidor)
    .eq('hash_arquivo', hashArquivo)
    .maybeSingle();

  if (jaProcessado) {
    return NextResponse.json({
      status: 'ja_processado' as StatusProcessamento,
      detalhes: {
        motivo: 'Mesmo arquivo (path + hash) já foi processado antes',
        statusAnterior: jaProcessado.status,
        processadoEm: jaProcessado.processado_em,
      },
    });
  }

  // 5. Resolve empresa pelo nome da pasta
  const nomePasta = extrairNomeEmpresaDoCaminho(caminhoServidor);
  if (!nomePasta) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: null, empresaNomePasta: null,
      tipoProblema: 'empresa_nao_encontrada',
      detalhes: { motivo: 'Caminho não tem segmento "EMPRESA" — verifique padrão T:\\Fiscal\\EMPRESA\\<NOME>\\...' },
      competenciaParseada: null, obrigacaoParseada: null,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: null, competencia: null, obrigacao: null,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'empresa_nao_encontrada' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'empresa_nao_encontrada' } });
  }

  const resEmpresa = await resolverEmpresaPorNomePasta(admin, nomePasta);
  if ('erro' in resEmpresa) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: null, empresaNomePasta: nomePasta,
      tipoProblema: 'empresa_nao_encontrada',
      detalhes: {
        motivo: resEmpresa.erro === 'ambigua'
          ? `Nome de pasta "${nomePasta}" bate com múltiplas empresas`
          : `Nome de pasta "${nomePasta}" não corresponde a nenhuma empresa cadastrada`,
        candidatos: resEmpresa.candidatos,
      },
      competenciaParseada: null, obrigacaoParseada: null,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: null, competencia: null, obrigacao: null,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'empresa_nao_encontrada', erro: resEmpresa.erro },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'empresa_nao_encontrada', erro: resEmpresa.erro } });
  }
  const empresa = resEmpresa.empresa;

  // 6. Detecta regime do path (FECHAMENTO / SIMPLES NACIONAL) — só pra logar/debug
  const regimePath = detectarRegimeDoCaminho(caminhoServidor);

  // 7. Parseia nome do arquivo
  const parse: ResultadoParseNome = parseNomeGuia(nomeArquivo);
  if (!parse.valido || !parse.competencia || !parse.obrigacao) {
    const tipoProblema = parse.erros.includes('obrigacao_desconhecida')
      ? 'obrigacao_desconhecida'
      : 'nome_fora_padrao';
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema,
      detalhes: {
        erros: parse.erros,
        obrigacaoEscrita: parse.obrigacaoOriginal,
        nomeSugerido: parse.nomeSugerido,
        regimePath,
      },
      competenciaParseada: parse.competencia,
      obrigacaoParseada: parse.obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia: parse.competencia,
      obrigacao: parse.obrigacao, nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema, erros: parse.erros },
    });
    return NextResponse.json({
      status: 'pendente_correcao',
      detalhes: { tipoProblema, erros: parse.erros, nomeSugerido: parse.nomeSugerido },
    });
  }

  const competencia = parse.competencia;
  const obrigacao = parse.obrigacao;

  // 8. Carrega config da obrigação pra empresa
  const { data: configRow } = await admin
    .from('empresa_obrigacoes_config')
    .select('ativa, codigos, nao_envia_cliente, motivo')
    .eq('empresa_id', empresa.id)
    .eq('obrigacao', obrigacao)
    .maybeSingle();

  const config = configRow as
    | { ativa: boolean; codigos: string[]; nao_envia_cliente: boolean; motivo: string | null }
    | null;

  // Default da tabela: linha ausente = ATIVA (modo "tudo ativo por padrão",
  // conforme regra documentada em supabase-migration-empresa-obrigacoes-config.sql).
  // Mas como o daemon está fazendo envio automático, vamos ser mais conservadores:
  // se não tem config, pede pra admin configurar primeiro.
  if (!config) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'obrigacao_nao_configurada',
      detalhes: {
        motivo: `A obrigação "${obrigacao}" não tem configuração cadastrada pra esta empresa. Configure em "Configurar Obrigações" (códigos esperados, se aplicável) antes de envios automáticos.`,
      },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'obrigacao_nao_configurada' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'obrigacao_nao_configurada' } });
  }

  if (!config.ativa) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'obrigacao_inativa',
      detalhes: {
        motivo: `A obrigação "${obrigacao}" está marcada como INATIVA pra esta empresa.`,
        motivoConfig: config.motivo,
      },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'obrigacao_inativa' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'obrigacao_inativa' } });
  }

  // 9. Validação rigorosa de PDF (defesa em profundidade — o daemon não valida)
  const validacao = await validarPdfNoServidor({
    buffer: fileBuffer, empresa, obrigacao,
    codigosEsperados: config.codigos ?? [],
    forcarEnvio: false, motivoForcar: undefined, podeForcar: false,
  });
  if (isErroApi(validacao)) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'validacao_falhou',
      detalhes: {
        motivo: validacao.error,
        bloqueios: validacao.meta?.bloqueios,
        perfilUsado: validacao.meta?.perfilUsado,
      },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'validacao_falhou' },
    });
    return NextResponse.json({
      status: 'pendente_correcao',
      detalhes: { tipoProblema: 'validacao_falhou', bloqueios: validacao.meta?.bloqueios },
    });
  }

  // 9.5. Safeguard: competência muito antiga não envia automaticamente.
  // Evita: alguém subir PDF retroativo de Março/2025 em Maio/2026 e o sistema
  // mandar email "Sua guia de Março/2025" pro cliente, que vai estranhar.
  if (!competenciaEhRecente(competencia)) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'competencia_antiga',
      detalhes: {
        motivo: `Competência ${competencia} tem mais de ${MAX_DIAS_COMPETENCIA_AUTOMATICA} dias. Aprove manualmente se realmente quiser enviar.`,
        diasLimite: MAX_DIAS_COMPETENCIA_AUTOMATICA,
        empresa: empresa.razao_social || empresa.apelido,
      },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_aprovacao_competencia_antiga',
      detalhes: { motivo: 'competencia_antiga', diasLimite: MAX_DIAS_COMPETENCIA_AUTOMATICA },
    });
    return NextResponse.json({
      status: 'pendente_aprovacao_competencia_antiga',
      detalhes: {
        motivo: `Competência ${competencia} > ${MAX_DIAS_COMPETENCIA_AUTOMATICA} dias atrás. Use a UI manual de Envio de Guias se quiser enviar.`,
      },
    });
  }

  // 10. Obrigação INTERNA (nao_envia_cliente=true): não envia email, só marca check
  if (config.nao_envia_cliente) {
    await marcarChecklistComoFeito(admin, {
      empresaId: empresa.id, mes: competencia, obrigacao, ghostUserId,
      arquivoNome: nomeArquivo, fonte: 'auto-interna',
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'interno_marcado_feito',
      detalhes: { motivo: 'Obrigação configurada como nao_envia_cliente — só marcou check' },
    });
    return NextResponse.json({
      status: 'interno_marcado_feito',
      detalhes: { empresa: empresa.codigo || empresa.razao_social, obrigacao, competencia },
    });
  }

  // 11. Modo conservador: 1ª vez dessa empresa+obrigação?
  const jaEnviouAntes = await jaTeveEnvioSucesso(admin, empresa.id, obrigacao);
  if (!jaEnviouAntes) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'primeira_vez_precisa_aprovacao',
      detalhes: {
        motivo: `Primeira vez enviando "${obrigacao}" pra esta empresa via sistema automático. Aprove manualmente — próximos envios sairão automáticos.`,
        empresa: empresa.razao_social || empresa.apelido,
        competencia,
      },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_aprovacao_primeira_vez',
      detalhes: { motivo: 'primeira_vez', validacao: validacao.resultado.perfilUsado },
    });
    return NextResponse.json({
      status: 'pendente_aprovacao_primeira_vez',
      detalhes: { motivo: '1ª vez — admin precisa aprovar', empresa: empresa.razao_social || empresa.apelido, obrigacao, competencia },
    });
  }

  // 12. Guard duplicado: já foi enviada essa empresa+mes+obrigação?
  const duplicado = await jaEnviadaNoChecklist(admin, empresa.id, competencia, obrigacao);
  if (duplicado) {
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'duplicado_periodo',
      detalhes: {
        motivo: 'Já houve envio anterior com sucesso pra essa empresa+competência+obrigação',
        enviadoEm: duplicado.enviadoEm,
      },
    });
    return NextResponse.json({
      status: 'duplicado_periodo',
      detalhes: { motivo: 'Já enviado antes', enviadoEm: duplicado.enviadoEm },
    });
  }

  // 13. Carrega token Gmail do ghost user
  const { data: tokenRow } = await admin
    .from('usuario_gmail_tokens')
    .select('email, refresh_token_enc, revoked')
    .eq('usuario_id', ghostUserId)
    .maybeSingle();

  if (!tokenRow || tokenRow.revoked) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'gmail_nao_conectado',
      detalhes: { motivo: 'Conta Gmail do ghost user (envio automático) não está conectada. Configure em /vencimentos-fiscais.' },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'gmail_nao_conectado' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'gmail_nao_conectado' } });
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(tokenRow.refresh_token_enc);
  } catch {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'gmail_nao_conectado',
      detalhes: { motivo: 'Falha ao decodificar token Gmail. Reconecte conta do ghost user.' },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'gmail_nao_conectado' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'gmail_nao_conectado' } });
  }

  // 14. Carrega emails da empresa
  const { data: emailsRes } = await admin
    .from('empresa_emails_cliente')
    .select('email')
    .eq('empresa_id', empresa.id)
    .eq('ativo', true);

  const emails = ((emailsRes ?? []) as Array<{ email: string }>).map((r) => r.email).filter(Boolean);
  if (emails.length === 0) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'sem_emails',
      detalhes: { motivo: 'Empresa não tem emails de cliente cadastrados. Cadastre em /empresas antes de envios automáticos.' },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'sem_emails' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'sem_emails' } });
  }

  // 15. Upload no Storage (bucket 'documentos' — pra histórico interno)
  const docPath = `empresas/${empresa.id}/auto/${randomUUID()}-${nomeArquivo}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET_DOCUMENTOS)
    .upload(docPath, fileBuffer, { contentType: 'application/pdf', upsert: false });

  if (upErr) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'erro_envio',
      detalhes: { motivo: 'Falha ao subir arquivo no Storage', erro: upErr.message },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'erro',
      detalhes: { motivo: 'storage_upload_failed', erro: upErr.message },
    });
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'storage_upload_failed', erro: upErr.message } }, { status: 500 });
  }

  // 16. Monta e envia email
  const empresaNome = empresa.razao_social || empresa.apelido || empresa.codigo;
  const competenciaLabel = formatComp(competencia);
  const vencimentoIso = calcularVencimento(obrigacao, empresa, competencia);
  const vencimentoLabel = vencimentoIso
    ? new Date(vencimentoIso.length === 10 ? vencimentoIso + 'T00:00:00' : vencimentoIso).toLocaleDateString('pt-BR')
    : null;
  const subject = `${obrigacao} — ${empresaNome} (${competenciaLabel})`;
  const linhaVencimento = vencimentoLabel ? `\nVencimento: ${vencimentoLabel}\n` : '';
  const bodyText =
    `Olá,\n\n` +
    `Segue em anexo o arquivo referente à obrigação ${obrigacao}, competência ${competenciaLabel}.` +
    linhaVencimento +
    `\nQualquer dúvida, estamos à disposição.\n\n` +
    `Atenciosamente.`;
  const escapeHtml = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(bodyText)}</div>`;

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const mime = buildMime({
    from: tokenRow.email, to: emails, subject, bodyText, bodyHtml,
    attachment: { filename: nomeArquivo, mime: mimeTypeFromFilename(nomeArquivo), content: fileBuffer },
  });
  const raw = Buffer.from(mime, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  let gmailMessageId: string | undefined;
  try {
    const sendRes = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    gmailMessageId = sendRes.data.id ?? undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha Gmail';
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'erro_envio',
      detalhes: { motivo: 'Falha ao enviar pelo Gmail', erro: message },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'erro',
      detalhes: { motivo: 'gmail_send_failed', erro: message },
    });
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'gmail_send_failed', erro: message } }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  await admin.from('usuario_gmail_tokens').update({ last_used_at: nowIso }).eq('usuario_id', ghostUserId);

  // 17. Marca checklist como feito + adiciona ao envios_historico
  const checklistId = await marcarChecklistComoFeito(admin, {
    empresaId: empresa.id, mes: competencia, obrigacao, ghostUserId,
    arquivoNome: nomeArquivo, fonte: 'auto-enviado', destinatarios: emails,
    gmailMessageId,
  });

  // 18. Publica no portal cliente (best-effort)
  let portalDocumentoId: string | null = null;
  try {
    const portalPath = `${empresa.id}/${randomUUID()}-${nomeArquivo}`;
    const { error: upPortalErr } = await admin.storage
      .from(BUCKET_PORTAL)
      .upload(portalPath, fileBuffer, { contentType: 'application/pdf', upsert: false });
    if (!upPortalErr) {
      if (checklistId) {
        await admin
          .from('portal_documentos')
          .update({ removido_em: nowIso, removido_por_usuario_id: ghostUserId })
          .eq('checklist_fiscal_id', checklistId)
          .is('removido_em', null);
      }
      const { data: novoPortal } = await admin
        .from('portal_documentos')
        .insert({
          empresa_id: empresa.id,
          checklist_fiscal_id: checklistId,
          obrigacao_nome: obrigacao,
          competencia,
          vencimento: vencimentoIso,
          arquivo_storage_path: portalPath,
          arquivo_nome_original: nomeArquivo,
          arquivo_mime: 'application/pdf',
          arquivo_tamanho_bytes: fileBuffer.byteLength,
          enviado_email: true,
          enviado_email_em: nowIso,
          criado_por_usuario_id: ghostUserId,
        })
        .select('id')
        .maybeSingle();
      portalDocumentoId = novoPortal?.id ?? null;

      // Push best-effort
      if (portalDocumentoId) {
        try {
          const { data: clienteRow } = await admin
            .from('clientes_portal').select('id').eq('empresa_id', empresa.id).eq('ativo', true).maybeSingle();
          if (clienteRow?.id) {
            const pushBody = vencimentoLabel
              ? `Competência ${competenciaLabel} · vence ${vencimentoLabel}.`
              : `Competência ${competenciaLabel}. Toque para abrir.`;
            await sendPushToCliente(clienteRow.id, {
              title: `Nova guia: ${obrigacao}`,
              body: pushBody,
              url: `/portal/documentos/${portalDocumentoId}`,
              tag: `portal-doc-${portalDocumentoId}`,
            });
          }
        } catch (pushErr) {
          console.error('[auto-enviar] falha push:', pushErr);
        }
      }
    }
  } catch (portalErr) {
    console.error('[auto-enviar] falha ao publicar no portal:', portalErr);
  }

  // 19. Registra como processado com sucesso
  await registrarProcessado(admin, {
    caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
    nomeArquivo, status: 'enviado',
    detalhes: {
      gmailMessageId,
      destinatarios: emails,
      portalDocumentoId,
      checklistId,
      perfilValidacao: validacao.resultado.perfilUsado,
    },
  });

  const resposta: RespostaAuto = {
    status: 'enviado',
    detalhes: {
      empresa: empresa.razao_social || empresa.apelido || empresa.codigo,
      obrigacao,
      competencia,
      destinatarios: emails,
      enviadoDe: tokenRow.email,
      gmailMessageId,
      portalDocumentoId,
      checklistId,
    },
  };
  return NextResponse.json(resposta);
}

// ─── Helpers DB ────────────────────────────────────────────────────────────

function calcularVencimento(obrigacao: string, empresa: Empresa, mes: string): string | null {
  const fiscal = vencimentoDoMes(obrigacao, empresa.estado, mes, empresa.cidade);
  if (fiscal) return fiscal;
  const sn = vencimentoDoMesSn(obrigacao, empresa.estado, mes, empresa.cidade);
  if (sn) return sn;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const obrigAlvo = norm(obrigacao);
  const manual = (empresa.vencimentosFiscais ?? []).find((v) => v?.nome && norm(v.nome) === obrigAlvo);
  return manual?.vencimento || null;
}

async function jaEnviadaNoChecklist(
  admin: SupabaseClient, empresaId: string, mes: string, obrigacao: string,
): Promise<{ enviadoEm: string } | null> {
  const { data } = await admin
    .from('checklist_fiscal')
    .select('envios_historico')
    .eq('empresa_id', empresaId).eq('mes', mes).eq('obrigacao', obrigacao)
    .maybeSingle();
  if (!data) return null;
  const envios = ((data as { envios_historico?: Array<{ sucesso?: boolean; enviado_em?: string }> | null })
    .envios_historico ?? []);
  const sucessos = envios.filter((e) => e.sucesso === true);
  if (sucessos.length === 0) return null;
  return { enviadoEm: sucessos[sucessos.length - 1].enviado_em ?? '' };
}

/**
 * Upsert checklist_fiscal: marca status feito + adiciona entrada em envios_historico.
 * Retorna o id do checklist (pra usar em portal_documentos).
 */
async function marcarChecklistComoFeito(
  admin: SupabaseClient,
  payload: {
    empresaId: string;
    mes: string;
    obrigacao: string;
    ghostUserId: string;
    arquivoNome: string;
    fonte: 'auto-enviado' | 'auto-interna';
    destinatarios?: string[];
    gmailMessageId?: string;
  },
): Promise<string | null> {
  const nowIso = new Date().toISOString();

  // Carrega ghost user pra nome no envio
  const { data: ghostRow } = await admin
    .from('usuarios').select('nome').eq('id', payload.ghostUserId).maybeSingle();
  const ghostNome = (ghostRow as { nome?: string } | null)?.nome ?? 'Sistema (automático)';

  // Busca checklist existente
  const { data: existente } = await admin
    .from('checklist_fiscal')
    .select('id, envios_historico')
    .eq('empresa_id', payload.empresaId)
    .eq('mes', payload.mes)
    .eq('obrigacao', payload.obrigacao)
    .maybeSingle();

  // Evento usa snake_case pra alinhar com o resto do JSONB (normalizarEnviosHistorico
  // aceita ambos, mas o sistema salva em snake_case).
  const novoEvento = {
    id: randomUUID(),
    sucesso: payload.fonte === 'auto-enviado',
    enviado_em: nowIso,
    enviado_por_id: payload.ghostUserId,
    enviado_por_nome: ghostNome,
    destinatarios: payload.destinatarios ?? [],
    arquivo_nome: payload.arquivoNome,
    gmail_message_id: payload.gmailMessageId,
    // Flag custom — permite filtrar no relatório "envios automáticos"
    automatico: true,
    fonte: payload.fonte,
  };

  // Tabela usa `concluido` (boolean) + `concluido_em` + `concluido_por_id` + `concluido_por_nome`
  // Status 'feito' marca também o boolean concluido=true. Veja src/lib/db.ts:upsertChecklistFiscal.
  const isSucesso = payload.fonte === 'auto-enviado' || payload.fonte === 'auto-interna';
  const camposChecklist = isSucesso
    ? {
        concluido: true,
        status: 'feito',
        concluido_em: nowIso,
        concluido_por_id: payload.ghostUserId,
        concluido_por_nome: ghostNome,
        atualizado_em: nowIso,
      }
    : { atualizado_em: nowIso };

  if (existente) {
    const historico = ((existente as { envios_historico?: unknown[] | null }).envios_historico ?? []) as unknown[];
    await admin
      .from('checklist_fiscal')
      .update({
        ...camposChecklist,
        envios_historico: [...historico, novoEvento],
      })
      .eq('id', (existente as { id: string }).id);
    return (existente as { id: string }).id;
  }

  const { data: novo } = await admin
    .from('checklist_fiscal')
    .insert({
      empresa_id: payload.empresaId,
      mes: payload.mes,
      obrigacao: payload.obrigacao,
      ...camposChecklist,
      envios_historico: [novoEvento],
    })
    .select('id')
    .maybeSingle();
  return (novo as { id?: string } | null)?.id ?? null;
}
