// Endpoint chamado pelo daemon local que olha a pasta T:/Fiscal/EMPRESA/.../*.pdf.
//
// Diferenças do `enviar-anexo`:
//   - Auth via header `X-Machine-Token` (env `AUTO_ENVIO_TOKEN`), não cookie de sessão
//   - Envio sai do Gmail do GHOST_USER_ID (não há "usuária logada")
//   - Resolução de empresa, parser de nome e validações geram entradas em
//     `guias_auto_problemas` em vez de erro pro cliente — daemon não tem
//     UI pra resolver, então o problema fica no painel /vencimentos-fiscais/auto-problemas
//   - Idempotência por (caminho_servidor + hash_arquivo) em `guias_auto_processadas`
//   - Modo conservador: 1ª vez de cada (empresa + obrigação) NÃO envia automaticamente,
//     deixa pendente de aprovação pra admin liberar manualmente
//
// Lógica de envio (Gmail + portal + checklist) mora em `_shared-envio.ts`
// pra ser reusada pela rota /api/admin/guias-auto/aprovar-e-enviar.

import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import {
  validarPdfNoServidor, carregarEmpresaCompleta, getSupabaseAdmin, isErroApi,
} from '../_shared';
import {
  parseNomeGuia, extrairNomeEmpresaDoCaminho, detectarRegimeDoCaminho,
  type ResultadoParseNome,
} from '@/lib/parseNomeGuia';
import {
  enviarGuia, marcarChecklistComoFeito, jaEnviadaNoChecklist, subirPendente,
} from './_shared-envio';
import { basename } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Empresa } from '@/app/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
// pede aprovação manual no painel. Evita mandar email "Sua guia de Março/2025"
// pro cliente em Maio/2026 quando alguém sobe PDF retroativo na pasta.
const MAX_DIAS_COMPETENCIA_AUTOMATICA = 60;

function competenciaEhRecente(competencia: string): boolean {
  const [y, m] = competencia.split('-').map(Number);
  if (!y || !m) return false;
  const fimDoMesCompetencia = new Date(Date.UTC(y, m, 0));
  const hoje = new Date();
  const diffDias = (hoje.getTime() - fimDoMesCompetencia.getTime()) / (1000 * 60 * 60 * 24);
  return diffDias <= MAX_DIAS_COMPETENCIA_AUTOMATICA;
}

interface RespostaAuto {
  status: StatusProcessamento;
  detalhes: Record<string, unknown>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Compara tokens em tempo constante (anti timing attack). */
function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
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

async function resolverEmpresaPorNomePasta(
  admin: SupabaseClient,
  nomePasta: string,
): Promise<{ empresa: Empresa } | { erro: 'nao_encontrada' | 'ambigua'; candidatos?: string[] }> {
  const normPasta = normalizarNomeEmpresa(nomePasta);
  if (!normPasta) return { erro: 'nao_encontrada' };

  const { data, error } = await admin.from('empresas').select('*');
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

  const completa = await carregarEmpresaCompleta(admin, matches[0].id);
  if (isErroApi(completa)) return { erro: 'nao_encontrada' };
  return { empresa: completa };
}

/**
 * Verifica se já houve algum envio (em qualquer mês) dessa combinação empresa
 * + obrigação. Usado pelo modo conservador "1ª vez precisa aprovação".
 */
async function jaTeveEnvioSucesso(
  admin: SupabaseClient,
  empresaId: string,
  obrigacao: string,
): Promise<boolean> {
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

  const { count } = await admin
    .from('guias_auto_processadas')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
    .eq('obrigacao', obrigacao)
    .eq('status', 'enviado');

  return (count ?? 0) > 0;
}

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

  // Rate limit defensivo contra runaway watcher. Gmail API tem hard cap de
  // ~500 envios/dia por conta — se o daemon entrar em loop (bug, FS event
  // duplicado, ataque) e mandar 1000 requests em 1min, queima a quota
  // inteira da conta ghost e bloqueia também os envios manuais.
  // Limites:
  //   - 20 req/min por IP: cobre fluxo normal (1 req a cada 3s é muito).
  //   - 300 req/h por IP: cobre mês inteiro em lote (~1000 PDFs em ~3h).
  const clientIp = getClientIp(req);
  const limitMin = rateLimit(`auto-enviar:min:${clientIp}`, 20, 60_000);
  if (!limitMin.ok) {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'Muitas requisições no último minuto. Watcher pode estar em loop.' } },
      { status: 429 },
    );
  }
  const limitHora = rateLimit(`auto-enviar:hora:${clientIp}`, 300, 60 * 60_000);
  if (!limitHora.ok) {
    return NextResponse.json(
      { status: 'erro', detalhes: { motivo: 'Muitas requisições na última hora. Quota diária do Gmail em risco.' } },
      { status: 429 },
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
  // Sobe o PDF pro Storage pra admin poder aprovar depois (Vercel não enxerga T:\).
  if (!competenciaEhRecente(competencia)) {
    const upPend = await subirPendente(admin, fileBuffer, nomeArquivo);
    const pathPendente = 'path' in upPend ? upPend.path : null;
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'competencia_antiga',
      detalhes: {
        motivo: `Competência ${competencia} tem mais de ${MAX_DIAS_COMPETENCIA_AUTOMATICA} dias. Aprove no painel se realmente quiser enviar.`,
        diasLimite: MAX_DIAS_COMPETENCIA_AUTOMATICA,
        empresa: empresa.razao_social || empresa.apelido,
      },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_aprovacao_competencia_antiga',
      detalhes: {
        motivo: 'competencia_antiga',
        diasLimite: MAX_DIAS_COMPETENCIA_AUTOMATICA,
        // Persistir o path pra rota /aprovar-e-enviar baixar e reenviar.
        // Se subirPendente falhou, o admin terá que usar /vencimentos-fiscais/envio manual.
        arquivo_pendente_path: pathPendente,
        codigos_esperados_snapshot: config.codigos ?? [],
        perfil_validacao_snapshot: validacao.resultado.perfilUsado,
      },
    });
    return NextResponse.json({
      status: 'pendente_aprovacao_competencia_antiga',
      detalhes: {
        motivo: `Competência ${competencia} > ${MAX_DIAS_COMPETENCIA_AUTOMATICA} dias atrás. Aprove no painel /vencimentos-fiscais/auto-problemas.`,
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
  // Sobe o PDF pro Storage pra admin poder aprovar depois.
  const jaEnviouAntes = await jaTeveEnvioSucesso(admin, empresa.id, obrigacao);
  if (!jaEnviouAntes) {
    const upPend = await subirPendente(admin, fileBuffer, nomeArquivo);
    const pathPendente = 'path' in upPend ? upPend.path : null;
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: 'primeira_vez_precisa_aprovacao',
      detalhes: {
        motivo: `Primeira vez enviando "${obrigacao}" pra esta empresa via sistema automático. Aprove no painel — próximos envios sairão automáticos.`,
        empresa: empresa.razao_social || empresa.apelido,
        competencia,
      },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_aprovacao_primeira_vez',
      detalhes: {
        motivo: 'primeira_vez',
        validacao: validacao.resultado.perfilUsado,
        arquivo_pendente_path: pathPendente,
        codigos_esperados_snapshot: config.codigos ?? [],
        perfil_validacao_snapshot: validacao.resultado.perfilUsado,
      },
    });
    return NextResponse.json({
      status: 'pendente_aprovacao_primeira_vez',
      detalhes: { motivo: '1ª vez — admin precisa aprovar no painel', empresa: empresa.razao_social || empresa.apelido, obrigacao, competencia },
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

  // 13. Envia (Gmail + portal + checklist) — fluxo compartilhado com /aprovar-e-enviar
  const envio = await enviarGuia(admin, {
    empresa, obrigacao, competencia, nomeArquivo, fileBuffer, ghostUserId,
  });

  if (!envio.ok) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: nomePasta,
      tipoProblema: envio.motivo === 'sem_emails' ? 'sem_emails'
                    : envio.motivo === 'gmail_nao_conectado' ? 'gmail_nao_conectado'
                    : 'erro_envio',
      detalhes: { motivo: envio.erro, falha: envio.motivo },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    const statusFinal: StatusProcessamento =
      (envio.motivo === 'sem_emails' || envio.motivo === 'gmail_nao_conectado') ? 'pendente_correcao' : 'erro';
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: statusFinal,
      detalhes: { motivo: envio.motivo, erro: envio.erro },
    });
    const httpStatus = envio.motivo === 'gmail_send_failed' ? 502
                     : envio.motivo === 'storage_upload_failed' ? 500
                     : 200;
    return NextResponse.json({ status: statusFinal, detalhes: { motivo: envio.motivo, erro: envio.erro } }, { status: httpStatus });
  }

  // 14. Sucesso
  await registrarProcessado(admin, {
    caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
    nomeArquivo, status: 'enviado',
    detalhes: {
      gmailMessageId: envio.gmailMessageId,
      destinatarios: envio.destinatarios,
      portalDocumentoId: envio.portalDocumentoId,
      checklistId: envio.checklistId,
      perfilValidacao: validacao.resultado.perfilUsado,
    },
  });

  const resposta: RespostaAuto = {
    status: 'enviado',
    detalhes: {
      empresa: empresa.razao_social || empresa.apelido || empresa.codigo,
      obrigacao,
      competencia,
      destinatarios: envio.destinatarios,
      enviadoDe: envio.enviadoDe,
      gmailMessageId: envio.gmailMessageId,
      portalDocumentoId: envio.portalDocumentoId,
      checklistId: envio.checklistId,
    },
  };
  return NextResponse.json(resposta);
}
