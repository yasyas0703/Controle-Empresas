// Endpoint chamado pelo daemon local que olha a pasta única
// T:/Fiscal/EMPRESA/1-GUIAS A ENVIAR/*.pdf.
//
// Diferenças do `enviar-anexo`:
//   - Auth via header `X-Machine-Token` (env `AUTO_ENVIO_TOKEN`), não cookie de sessão
//   - Envio sai do Gmail do GHOST_USER_ID (não há "usuária logada")
//   - Identificação 100% pelo CONTEÚDO do PDF (OCR/extração de texto): empresa por
//     CNPJ/Inscrição Estadual, obrigação pelo perfil de validação, competência pelo
//     período de apuração. Não usa mais nome de pasta nem padrão de nome de arquivo.
//   - Falhas geram entradas em `guias_auto_problemas` em vez de erro pro cliente —
//     daemon não tem UI; o problema fica no painel /vencimentos-fiscais/auto-problemas
//   - Idempotência por hash do arquivo em `guias_auto_processadas`
//   - Modo conservador: 1ª vez de cada (empresa + obrigação) NÃO envia automaticamente,
//     deixa pendente de aprovação pra admin liberar manualmente
//   - Resposta de sucesso inclui `destino` pro daemon arquivar o PDF na pasta da empresa
//
// Lógica de envio (Gmail + portal + checklist) mora em `_shared-envio.ts`
// pra ser reusada pela rota /api/admin/guias-auto/aprovar-e-enviar.

import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import {
  validarPdfNoServidor, carregarEmpresaCompleta, getSupabaseAdmin, isErroApi, extrairTextoPdfServidor,
} from '../_shared';
import { extrairNomeArquivoDoCaminho } from '@/lib/parseNomeGuia';
import {
  enviarGuia, marcarChecklistComoFeito, jaEnviadaNoChecklist, subirPendente, subirDocumentoInterno,
} from './_shared-envio';
import {
  identificarEmpresa, identificarObrigacao, competenciaDoPdf, type ConfigObrigacao,
} from './_identificar';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Empresa } from '@/app/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Tipos do retorno ──────────────────────────────────────────────────────
type StatusProcessamento =
  | 'enviado'                              // tudo certo, email saiu
  | 'ja_processado'                        // hash já foi enviado antes
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

// Competência à frente do mês corrente. As guias costumam ser do mês anterior;
// uma competência no futuro quase sempre é PDF do mês errado na pasta.
function competenciaEhFutura(competencia: string): boolean {
  const [y, m] = competencia.split('-').map(Number);
  if (!y || !m) return false;
  const hoje = new Date();
  const atualYM = hoje.getUTCFullYear() * 12 + hoje.getUTCMonth(); // mês corrente (0-based)
  const compYM = y * 12 + (m - 1);
  return compYM > atualYM;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Compara tokens em tempo constante (anti timing attack). */
function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Tira caracteres inválidos pra nome de arquivo (Windows + storage path). */
function sanitizeNomeArquivo(nome: string): string {
  return nome.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

/** Nome canônico da guia — usado no anexo do email E no arquivo arquivado no T:. */
function nomeCanonicoGuia(competencia: string, obrigacao: string): string {
  return `${sanitizeNomeArquivo(`${competencia} - ${obrigacao}`)}.pdf`;
}

/** Pasta de regime no T: conforme a tributação da empresa. */
function regimePastaDaEmpresa(empresa: Empresa): 'FECHAMENTO' | 'SIMPLES NACIONAL' {
  return empresa.tributacao === 'simples_nacional' ? 'SIMPLES NACIONAL' : 'FECHAMENTO';
}

/**
 * Monta o bloco `destino` que o daemon usa pra mover o PDF da pasta de entrada
 * pra pasta definitiva da empresa: T:/Fiscal/EMPRESA/<EMPRESA>/<REGIME>/<ANO>/.
 * O daemon resolve a pasta real da empresa por fuzzy match dos candidatos.
 */
function montarDestino(empresa: Empresa, competencia: string, nomeArquivo: string) {
  return {
    candidatosPasta: [empresa.apelido, empresa.razao_social, empresa.codigo].filter((v): v is string => !!v),
    regime: regimePastaDaEmpresa(empresa),
    ano: competencia.slice(0, 4),
    nomeArquivo,
  };
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
  // Corta em / E \ — caminho vem do Windows (watcher), API roda no Linux (Vercel).
  const nomeArquivo = extrairNomeArquivoDoCaminho(caminhoServidor);
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

  // 4. Idempotência por HASH (conteúdo). Como agora todas as guias caem na mesma
  // pasta de entrada e o arquivo é movido após processar, o caminho não é estável
  // — a chave passa a ser o hash. Só faz curto-circuito em status TERMINAL de
  // sucesso; pendências/erros podem ser reprocessados (re-soltar após corrigir
  // config, p.ex.). Double-send segue barrado pelo guard de duplicado (passo 14).
  const { data: jaProcessado } = await admin
    .from('guias_auto_processadas')
    .select('id, status, processado_em')
    .eq('hash_arquivo', hashArquivo)
    .in('status', ['enviado', 'interno_marcado_feito'])
    .order('processado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jaProcessado) {
    return NextResponse.json({
      status: 'ja_processado' as StatusProcessamento,
      detalhes: {
        motivo: 'Mesmo arquivo (hash) já foi enviado antes',
        statusAnterior: jaProcessado.status,
        processadoEm: jaProcessado.processado_em,
      },
    });
  }

  // 5. Extrai o texto do PDF UMA vez — base de toda a identificação por conteúdo.
  let textoPdf = '';
  try {
    textoPdf = await extrairTextoPdfServidor(fileBuffer);
  } catch {
    textoPdf = '';
  }
  if (!textoPdf.trim()) {
    // PDF imagem/escaneado/criptografado — sem texto não dá pra identificar nada.
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: null, empresaNomePasta: null,
      tipoProblema: 'pdf_ilegivel',
      detalhes: { motivo: 'Não consegui extrair texto do PDF (provavelmente imagem/escaneado). Identificação por conteúdo impossível.' },
      competenciaParseada: null, obrigacaoParseada: null,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: null, competencia: null, obrigacao: null,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'pdf_ilegivel' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'pdf_ilegivel' } });
  }

  // 6. Identifica a EMPRESA pelo conteúdo (CNPJ/IE = forte; só razão social = fraco).
  const { data: empresasRows } = await admin.from('empresas').select('*');
  const todasEmpresas = (empresasRows ?? []) as Empresa[];
  const identEmpresa = identificarEmpresa(textoPdf, todasEmpresas);

  if (!identEmpresa.empresa) {
    const tipoProblema = identEmpresa.ambiguo ? 'empresa_ambigua' : 'empresa_nao_identificada';
    const motivo = identEmpresa.ambiguo
      ? 'Mais de uma empresa com CNPJ/Inscrição no PDF — não dá pra decidir com segurança.'
      : 'Nenhuma empresa cadastrada foi reconhecida no conteúdo do PDF (CNPJ, IE ou razão social).';
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: null, empresaNomePasta: null,
      tipoProblema,
      detalhes: { motivo, candidatos: identEmpresa.candidatos },
      competenciaParseada: null, obrigacaoParseada: null,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: null, competencia: null, obrigacao: null,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema, candidatos: identEmpresa.candidatos },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema, candidatos: identEmpresa.candidatos } });
  }

  const empresaBase = identEmpresa.empresa;

  // Match fraco (só razão social) NÃO envia sozinho — risco de mandar pro cliente
  // errado. Vira pendência pra um humano confirmar e mandar pela aba de Envio.
  if (!identEmpresa.forte) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresaBase.id, empresaNomePasta: null,
      tipoProblema: 'empresa_match_fraco',
      detalhes: {
        motivo: `A guia parece ser de "${empresaBase.razao_social || empresaBase.apelido}", mas o PDF não traz o CNPJ nem a Inscrição Estadual dela. Por segurança, não envio automaticamente.`,
        empresaSuspeita: empresaBase.razao_social || empresaBase.apelido,
        candidatos: identEmpresa.candidatos,
      },
      competenciaParseada: null, obrigacaoParseada: null,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresaBase.id, competencia: null, obrigacao: null,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'empresa_match_fraco' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'empresa_match_fraco' } });
  }

  // Recarrega a empresa no shape completo (vencimentosFiscais etc.) pro downstream.
  const empresaCompleta = await carregarEmpresaCompleta(admin, empresaBase.id);
  if (isErroApi(empresaCompleta)) {
    return NextResponse.json({ status: 'erro', detalhes: { motivo: 'Falha ao carregar empresa identificada.' } }, { status: 500 });
  }
  const empresa = empresaCompleta;

  // 7. Carrega TODAS as configs de obrigação da empresa (pra identificar e validar).
  const { data: configRows } = await admin
    .from('empresa_obrigacoes_config')
    .select('obrigacao, ativa, codigos, nao_envia_cliente, motivo')
    .eq('empresa_id', empresa.id);

  const configs = new Map<string, ConfigObrigacao>();
  for (const row of (configRows ?? []) as Array<{ obrigacao: string; ativa: boolean; codigos: string[] | null; nao_envia_cliente: boolean; motivo: string | null }>) {
    configs.set(row.obrigacao, {
      ativa: row.ativa,
      codigos: Array.isArray(row.codigos) ? row.codigos : [],
      naoEnviaCliente: row.nao_envia_cliente,
      motivo: row.motivo,
    });
  }

  // 8. Identifica a OBRIGAÇÃO pelo conteúdo + a COMPETÊNCIA.
  const identObr = identificarObrigacao(textoPdf, empresa, configs);
  if (!identObr.obrigacao) {
    const tipoProblema = identObr.ambiguo ? 'obrigacao_ambigua' : 'obrigacao_nao_identificada';
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: null,
      tipoProblema,
      detalhes: {
        motivo: identObr.ambiguo
          ? 'Mais de um tipo de guia bate com o conteúdo e o código de receita não desempatou.'
          : 'Não reconheci o tipo de guia pelo conteúdo do PDF.',
        candidatos: identObr.candidatos,
      },
      competenciaParseada: null, obrigacaoParseada: null,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia: null, obrigacao: null,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema, candidatos: identObr.candidatos },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema, candidatos: identObr.candidatos } });
  }
  const obrigacao = identObr.obrigacao;

  const competencia = competenciaDoPdf(textoPdf);
  if (!competencia) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: null,
      tipoProblema: 'competencia_nao_identificada',
      detalhes: { motivo: 'Não achei a competência (mês/ano de referência) no PDF.' },
      competenciaParseada: null, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia: null, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'competencia_nao_identificada' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'competencia_nao_identificada' } });
  }

  // 9. Confere a config da obrigação identificada.
  const config = configs.get(obrigacao) ?? null;
  if (!config) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: null,
      tipoProblema: 'obrigacao_nao_configurada',
      detalhes: { motivo: `A obrigação "${obrigacao}" não tem configuração cadastrada pra esta empresa. Configure em "Configurar Obrigações" antes de envios automáticos.` },
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
      empresaId: empresa.id, empresaNomePasta: null,
      tipoProblema: 'obrigacao_inativa',
      detalhes: { motivo: `A obrigação "${obrigacao}" está marcada como INATIVA pra esta empresa.`, motivoConfig: config.motivo },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'obrigacao_inativa' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'obrigacao_inativa' } });
  }

  // Nome canônico — não depende mais do nome que a pessoa deu ao arquivo na entrada.
  const nomeCanonico = nomeCanonicoGuia(competencia, obrigacao);

  // 10. Validação rigorosa de PDF (defesa em profundidade).
  const validacao = await validarPdfNoServidor({
    buffer: fileBuffer, empresa, obrigacao,
    codigosEsperados: config.codigos ?? [],
    forcarEnvio: false, motivoForcar: undefined, podeForcar: false,
  });
  if (isErroApi(validacao)) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: null,
      tipoProblema: 'validacao_falhou',
      detalhes: { motivo: validacao.error, bloqueios: validacao.meta?.bloqueios, perfilUsado: validacao.meta?.perfilUsado },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'validacao_falhou' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'validacao_falhou', bloqueios: validacao.meta?.bloqueios } });
  }

  // 11. Safeguard de competência: nem no futuro, nem muito antiga.
  if (competenciaEhFutura(competencia)) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: null,
      tipoProblema: 'competencia_futura',
      detalhes: { motivo: `Competência ${competencia} está no futuro. As guias costumam ser do mês anterior — confira se o PDF é o certo.` },
      competenciaParseada: competencia, obrigacaoParseada: obrigacao,
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'pendente_correcao',
      detalhes: { tipoProblema: 'competencia_futura' },
    });
    return NextResponse.json({ status: 'pendente_correcao', detalhes: { tipoProblema: 'competencia_futura' } });
  }

  if (!competenciaEhRecente(competencia)) {
    const upPend = await subirPendente(admin, fileBuffer, nomeCanonico);
    const pathPendente = 'path' in upPend ? upPend.path : null;
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: null,
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
        // Path pra rota /aprovar-e-enviar baixar e reenviar depois.
        arquivo_pendente_path: pathPendente,
        codigos_esperados_snapshot: config.codigos ?? [],
        perfil_validacao_snapshot: validacao.resultado.perfilUsado,
      },
    });
    return NextResponse.json({
      status: 'pendente_aprovacao_competencia_antiga',
      detalhes: { motivo: `Competência ${competencia} > ${MAX_DIAS_COMPETENCIA_AUTOMATICA} dias atrás. Aprove no painel /vencimentos-fiscais/auto-problemas.` },
    });
  }

  // 12. Obrigação INTERNA (nao_envia_cliente=true): não envia email, só marca
  // check — mas salva o PDF anexado na célula do Checklist mesmo assim.
  if (config.naoEnviaCliente) {
    const docPathInterno = await subirDocumentoInterno(admin, empresa.id, fileBuffer, nomeCanonico);
    await marcarChecklistComoFeito(admin, {
      empresaId: empresa.id, mes: competencia, obrigacao, ghostUserId,
      arquivoNome: nomeCanonico, arquivoUrl: docPathInterno ?? undefined, fonte: 'auto-interna',
    });
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'interno_marcado_feito',
      detalhes: { motivo: 'Obrigação configurada como nao_envia_cliente — só marcou check' },
    });
    return NextResponse.json({
      status: 'interno_marcado_feito',
      detalhes: { empresa: empresa.codigo || empresa.razao_social, obrigacao, competencia },
      destino: montarDestino(empresa, competencia, nomeCanonico),
    });
  }

  // 13. Modo conservador: 1ª vez dessa empresa+obrigação?
  const jaEnviouAntes = await jaTeveEnvioSucesso(admin, empresa.id, obrigacao);
  if (!jaEnviouAntes) {
    const upPend = await subirPendente(admin, fileBuffer, nomeCanonico);
    const pathPendente = 'path' in upPend ? upPend.path : null;
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: null,
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

  // 14. Guard duplicado: já foi enviada essa empresa+mes+obrigação?
  const duplicado = await jaEnviadaNoChecklist(admin, empresa.id, competencia, obrigacao);
  if (duplicado) {
    await registrarProcessado(admin, {
      caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
      nomeArquivo, status: 'duplicado_periodo',
      detalhes: { motivo: 'Já houve envio anterior com sucesso pra essa empresa+competência+obrigação', enviadoEm: duplicado.enviadoEm },
    });
    return NextResponse.json({ status: 'duplicado_periodo', detalhes: { motivo: 'Já enviado antes', enviadoEm: duplicado.enviadoEm } });
  }

  // 15. Envia (Gmail + portal + checklist) — anexo com nome canônico.
  const envio = await enviarGuia(admin, {
    empresa, obrigacao, competencia, nomeArquivo: nomeCanonico, fileBuffer, ghostUserId,
  });

  if (!envio.ok) {
    await registrarProblema(admin, {
      caminhoServidor, nomeArquivo, hashArquivo,
      empresaId: empresa.id, empresaNomePasta: null,
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

  // 16. Sucesso
  await registrarProcessado(admin, {
    caminhoServidor, hashArquivo, empresaId: empresa.id, competencia, obrigacao,
    nomeArquivo, status: 'enviado',
    detalhes: {
      gmailMessageId: envio.gmailMessageId,
      destinatarios: envio.destinatarios,
      portalDocumentoId: envio.portalDocumentoId,
      checklistId: envio.checklistId,
      perfilValidacao: validacao.resultado.perfilUsado,
      tipoMatchEmpresa: identEmpresa.tipoMatch,
    },
  });

  return NextResponse.json({
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
    destino: montarDestino(empresa, competencia, nomeCanonico),
  });
}
