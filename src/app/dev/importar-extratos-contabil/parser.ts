import type {
  ContaBancaria,
  ControleContabilStatus,
  Empresa,
  Tributacao,
  UUID,
  Usuario,
} from '@/app/types';

// ─── Mapeamento de iniciais → nome real do membro do dep contábil ───
// O mapa muda por ano porque o time foi rotacionando. Iniciais que não estão
// no map ficam só como "feito/verde" sem usuário (não vira aviso).
const INICIAIS_POR_ANO: Record<number, Record<string, string>> = {
  2023: {
    A: 'Arnold',
    D: 'Diana',
    T: 'Thaciane',
    L: 'Lucas',
  },
  2024: {
    A: 'Arnold',
    D: 'Diana',
    E: 'Emily',
    G: 'Guilherme',
    J: 'João Victor',
    L: 'Lucas',
    P: 'Poliana',
    T: 'Thaciane',
  },
  2025: {
    A: 'Arnold',
    D: 'Diego',
    E: 'Emilly',
    G: 'Guilherme',
    P: 'Poliana',
    T: 'Thaciane',
  },
};

// Mapa default — usado pra 2026+ ou ano desconhecido. Mantém o time atual.
const INICIAIS_DEFAULT: Record<string, string> = {
  D: 'Diego Henrique',
  B: 'Brenda',
  A: 'Arnold',
  E: 'Emilyn',
  N: 'Nicolas',
  V: 'Victoria',
  T: 'Thaciane',
  P: 'Poliana',
};

export function getIniciaisMapPorAno(ano: number): Record<string, string> {
  return INICIAIS_POR_ANO[ano] ?? INICIAIS_DEFAULT;
}

// Mantido pra compatibilidade — usa o mapa default
export const INICIAIS_MAP = INICIAIS_DEFAULT;

/**
 * Aceita célula com inicial pura ('D') OU nome inteiro ('Diana', 'Diane').
 * Retorna a letra inicial uppercase normalizada se o map do ano tem essa letra,
 * caso contrário retorna null.
 */
export function extrairInicial(texto: string, mapaAno: Record<string, string>): string | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  // Procura a primeira letra alfabética (ignora dígitos, espaços, símbolos)
  for (const ch of limpo) {
    if (/[a-zA-ZÀ-ÿ]/.test(ch)) {
      const upper = ch
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase();
      if (mapaAno[upper]) return upper;
      return null;
    }
  }
  return null;
}

// Iniciais que NÃO devem virar usuário (S/M = sem movimento, S/E = sem extrato/equivalente)
export const TOKEN_SEM_MOVIMENTO = new Set(['S/M', 'S/E', 'SM', 'SE']);
export const TOKEN_VAZIO = new Set(['', '-', '–', '—']);

// Bancos a ignorar (linha de marcador, sem banco real)
export const BANCO_IGNORAR = new Set(['', 'FILIAL', 'SEM BANCO', '-']);

// ─── Tipos de saída do parser ───────────────────────────────

export interface PreviewTributacao {
  empresaId: UUID;
  codigo: string;
  nomeEmpresa: string;
  tributacaoAntes: Tributacao | null;
  tributacaoDepois: Tributacao;
}

export interface PreviewEmpresaArquivada {
  tempKey: string;
  /**
   * `codigo_reciclado`: o código existe no sistema mas pertence a outra empresa
   *   (foi reciclado). Cria-se uma nova com código sintético tipo 595-A.
   * `nao_encontrada`: o código não existe no sistema. Cria-se uma nova empresa
   *   com o próprio código original e marca como desligada (desligada_em).
   */
  motivo: 'codigo_reciclado' | 'nao_encontrada';
  codigoOriginal: string;
  codigoSintetico: string;     // = codigoOriginal quando motivo=nao_encontrada
  razaoSocial: string;
  tributacaoSugerida: Tributacao | null;
  similaridade: number;        // 0 quando motivo=nao_encontrada
  nomeEmpresaAtualNoSistema: string; // '' quando motivo=nao_encontrada
  selecionada: boolean;
  /** Data de desligamento sugerida — só usado em nao_encontrada. ISO YYYY-MM-DD. */
  desligadaEm: string | null;
}

export interface PreviewBancoNovo {
  tempKey: string;
  empresaId?: UUID;
  empresaArquivadaTempKey?: string;
  codigoEmpresa: string;
  nomeEmpresa: string;
  nome: string;
}

export interface PreviewStatus {
  empresaId?: UUID;
  empresaArquivadaTempKey?: string;
  codigoEmpresa: string;
  nomeEmpresa: string;
  bancoExistenteId?: UUID;     // se já existe
  bancoTempKey?: string;       // se será criado nessa importação
  bancoNome: string;
  mes: string;                 // YYYY-MM
  status: ControleContabilStatus;
  marcadoPorId: UUID | null;
  marcadoPorNome: string | null;
  observacao: string | null;
  origemValorCsv: string;      // pra debug/log: o caractere que veio do CSV
}

export interface PreviewAviso {
  tipo: 'empresa_nao_encontrada' | 'duplicata_secao' | 'inicial_desconhecida' | 'linha_sem_codigo' | 'sem_banco_atual';
  mensagem: string;
  contexto?: string;
}

export interface ParsedImportacao {
  ano: number;
  tributacoes: PreviewTributacao[];
  bancosNovos: PreviewBancoNovo[];
  statuses: PreviewStatus[];
  avisos: PreviewAviso[];
  empresasNaoEncontradas: Array<{ codigo: string; nome: string }>;
  empresasArquivadas: PreviewEmpresaArquivada[];
  totalLinhasCsv: number;
}

export const TAG_ARQUIVADA = 'arquivada';
export const TAG_DESLIGADA_HISTORICA = 'desligada-historica';

// ─── Helpers ────────────────────────────────────────────────

export function normalizarString(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function splitLinhaCsv(linha: string): string[] {
  // CSV simples com ;. Não tem aspas no arquivo dele, então basta split.
  return linha.split(';').map((c) => c.trim());
}

function detectarSecao(cols: string[]): Tributacao | null {
  const primeira = normalizarString(cols[0] ?? '');
  if (!primeira) return null;
  if (primeira === 'lucro real') return 'lucro_real';
  if (primeira === 'lucro presumido') return 'lucro_presumido';
  if (primeira === 'simples nacional') return 'simples_nacional';
  return null;
}

function isLinhaEmBranco(cols: string[]): boolean {
  return cols.every((c) => !c || c === '-' || c === '–');
}

export function nomeBancoLimpo(nome: string): string {
  // Mantém o nome quase como está, só remove espaços extras
  return nome.replace(/\s+/g, ' ').trim();
}

export function bancoIgnorar(nome: string): boolean {
  const upper = nome.trim().toUpperCase();
  return BANCO_IGNORAR.has(upper);
}

export function findEmpresaPorCodigo(empresas: Empresa[], codigo: string): Empresa | null {
  const alvo = codigo.replace(/\D/g, ''); // só dígitos
  if (!alvo) return null;
  return empresas.find((e) => (e.codigo ?? '').replace(/\D/g, '') === alvo) ?? null;
}

// ─── Similaridade de nomes (pra detectar código reciclado) ──
const SUFIXOS_EMPRESA = [
  'ltda', 'me', 'eireli', 'epp', 'sa', 's/a', 's.a', 's/s', 's.s',
  'cia', 'me', 'mei', 'eireli', 'eppi', 'inc', 'co',
];

function tokenizarNomeEmpresa(nome: string): Set<string> {
  const norm = normalizarString(nome)
    .replace(/[.,;:/\-()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = norm.split(' ')
    .filter((t) => t.length >= 2)
    .filter((t) => !SUFIXOS_EMPRESA.includes(t));
  return new Set(tokens);
}

// Jaccard: |A ∩ B| / |A ∪ B|. Vai de 0 a 1.
export function similaridadeNomes(nomeA: string, nomeB: string): number {
  const a = tokenizarNomeEmpresa(nomeA);
  const b = tokenizarNomeEmpresa(nomeB);
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const uniao = a.size + b.size - intersect;
  return uniao === 0 ? 0 : intersect / uniao;
}

// Threshold pra considerar match (mesma empresa, ignorando variações tipo " - LTDA")
export const SIMILARIDADE_MIN_MATCH = 0.4;

// Gera código sintético único pra empresa arquivada: 595-A, 595-A2, 595-A3, ...
export function gerarCodigoSinteticoArquivada(
  codigoBase: string,
  empresasExistentes: Empresa[],
  jaPlanejadas: PreviewEmpresaArquivada[]
): string {
  const codigosSistema = new Set(empresasExistentes.map((e) => (e.codigo ?? '').trim()));
  const codigosPlanejados = new Set(jaPlanejadas.map((a) => a.codigoSintetico));
  const sufixos = ['A', ...Array.from({ length: 99 }, (_, i) => `A${i + 2}`)];
  for (const sufixo of sufixos) {
    const candidato = `${codigoBase}-${sufixo}`;
    if (!codigosSistema.has(candidato) && !codigosPlanejados.has(candidato)) return candidato;
  }
  // Fallback (improvável de chegar aqui)
  return `${codigoBase}-A${Date.now()}`;
}

export function findUsuarioPorNome(usuarios: Usuario[], nome: string): Usuario | null {
  const alvo = normalizarString(nome).split(' ')[0]; // só primeiro nome
  if (!alvo) return null;
  // Match começando pelo primeiro nome (insensitive a acentos/case)
  return usuarios.find((u) => {
    const primeiro = normalizarString(u.nome).split(' ')[0];
    return primeiro === alvo;
  }) ?? null;
}

export function findContaExistente(contas: ContaBancaria[], empresaId: UUID, nomeBanco: string): ContaBancaria | null {
  const alvo = normalizarString(nomeBanco);
  return contas.find((c) => c.empresaId === empresaId && normalizarString(c.nome) === alvo) ?? null;
}

// ─── Parser principal ───────────────────────────────────────

export interface ParserInput {
  csv: string;
  ano: number;
  empresas: Empresa[];
  usuarios: Usuario[];
  contasExistentes: ContaBancaria[];
}

export function parseCsvImportacao(input: ParserInput): ParsedImportacao {
  const { csv, ano, empresas, usuarios, contasExistentes } = input;
  const iniciaisMap = getIniciaisMapPorAno(ano);

  const linhas = csv.split(/\r?\n/);
  const tributacoes: PreviewTributacao[] = [];
  const bancosNovos: PreviewBancoNovo[] = [];
  const statuses: PreviewStatus[] = [];
  const avisos: PreviewAviso[] = [];
  const empresasNaoEncontradas: Array<{ codigo: string; nome: string }> = [];
  const empresasArquivadas: PreviewEmpresaArquivada[] = [];

  // tracker pra evitar duplicar tributacao por empresa
  const tributacoesAplicadas = new Set<UUID>();
  // tracker pra evitar criar banco duplicado dentro do mesmo CSV
  const bancosNovosKey = new Set<string>(); // `${empresaId|empresaArquivadaTempKey}|${normalizado}`

  let secao: Tributacao | null = null;
  let empresaAtual: Empresa | null = null;
  let empresaArquivadaAtualTempKey: string | null = null;
  let bancoAtualExistenteId: UUID | null = null;
  let bancoAtualTempKey: string | null = null;
  let bancoAtualNome: string | null = null;

  // Tributação fica "pendente" e só é aplicada quando a empresa tiver pelo menos
  // um banco real (ignora empresas marcadas só como FILIAL/SEM BANCO).
  let tributacaoPendente: Tributacao | null = null;
  let empresaAtualTemBancoReal = false;
  const commitTributacaoPendente = () => {
    if (empresaAtual && tributacaoPendente && empresaAtualTemBancoReal && !tributacoesAplicadas.has(empresaAtual.id)) {
      tributacoesAplicadas.add(empresaAtual.id);
      if (empresaAtual.tributacao !== tributacaoPendente) {
        tributacoes.push({
          empresaId: empresaAtual.id,
          codigo: empresaAtual.codigo,
          nomeEmpresa: empresaAtual.razao_social ?? empresaAtual.apelido ?? '',
          tributacaoAntes: empresaAtual.tributacao ?? null,
          tributacaoDepois: tributacaoPendente,
        });
      }
    }
  };

  for (let idx = 0; idx < linhas.length; idx++) {
    const linhaTexto = linhas[idx];
    if (!linhaTexto || !linhaTexto.includes(';')) continue;

    const cols = splitLinhaCsv(linhaTexto);
    if (isLinhaEmBranco(cols)) continue;

    // Cabeçalho/seção
    const novaSecao = detectarSecao(cols);
    if (novaSecao) {
      secao = novaSecao;
      continue;
    }

    // Pula header literal
    const primeiraCol = (cols[0] ?? '').toLowerCase();
    if (primeiraCol === 'onge' || primeiraCol === 'codigo' || primeiraCol === 'código') continue;

    const codigoRaw = (cols[0] ?? '').trim();
    const nomeEmpresaRaw = (cols[1] ?? '').trim();
    const bancoRaw = (cols[2] ?? '').trim();
    // cols[3] é "ano" mas geralmente vazio — ignoramos e usamos o ano param
    const meses: string[] = [];
    for (let i = 4; i <= 15; i++) meses.push((cols[i] ?? '').trim());

    // Se tem código + nome → nova empresa
    if (codigoRaw && nomeEmpresaRaw) {
      // Antes de trocar, finaliza a tributação da empresa anterior (se houve banco real)
      commitTributacaoPendente();

      const e = findEmpresaPorCodigo(empresas, codigoRaw);
      if (!e) {
        // Não está no sistema → cria como empresa desligada usando o próprio
        // código original.
        const tempKey = `arq_${empresasArquivadas.length}`;
        empresasNaoEncontradas.push({ codigo: codigoRaw, nome: nomeEmpresaRaw });
        empresasArquivadas.push({
          tempKey,
          motivo: 'nao_encontrada',
          codigoOriginal: codigoRaw,
          codigoSintetico: codigoRaw,
          razaoSocial: nomeEmpresaRaw,
          tributacaoSugerida: secao,
          similaridade: 0,
          nomeEmpresaAtualNoSistema: '',
          selecionada: true,
          desligadaEm: null,
        });
        empresaAtual = null;
        empresaArquivadaAtualTempKey = tempKey;
        bancoAtualExistenteId = null;
        bancoAtualTempKey = null;
        bancoAtualNome = null;
        tributacaoPendente = null;
        empresaAtualTemBancoReal = false;
        continue;
      }

      // Verifica se o nome bate. Se não, é código reciclado → cadastra como empresa arquivada nova.
      const nomeSistema = e.razao_social ?? e.apelido ?? '';
      const sim = similaridadeNomes(nomeEmpresaRaw, nomeSistema);
      if (sim < SIMILARIDADE_MIN_MATCH) {
        const codigoSintetico = gerarCodigoSinteticoArquivada(codigoRaw, empresas, empresasArquivadas);
        const tempKey = `arq_${empresasArquivadas.length}`;
        empresasArquivadas.push({
          tempKey,
          motivo: 'codigo_reciclado',
          codigoOriginal: codigoRaw,
          codigoSintetico,
          razaoSocial: nomeEmpresaRaw,
          tributacaoSugerida: secao,
          similaridade: sim,
          nomeEmpresaAtualNoSistema: nomeSistema,
          selecionada: true,
          desligadaEm: null,
        });
        empresaAtual = null;
        empresaArquivadaAtualTempKey = tempKey;
        bancoAtualExistenteId = null;
        bancoAtualTempKey = null;
        bancoAtualNome = null;
        tributacaoPendente = null; // arquivada: tributação fica no próprio objeto
        empresaAtualTemBancoReal = false;
        continue;
      }

      empresaAtual = e;
      empresaArquivadaAtualTempKey = null;
      bancoAtualExistenteId = null;
      bancoAtualTempKey = null;
      bancoAtualNome = null;
      empresaAtualTemBancoReal = false;
      tributacaoPendente = secao;

      if (secao && tributacoesAplicadas.has(e.id)) {
        avisos.push({
          tipo: 'duplicata_secao',
          mensagem: `Empresa ${e.codigo} ${e.razao_social ?? ''} aparece em mais de uma seção de tributação. Mantida a primeira.`,
        });
      }
    }

    // Helper: contexto da empresa atual (real ou arquivada)
    const ctx = empresaAtual
      ? {
          empresaId: empresaAtual.id as UUID | undefined,
          arquivadaTempKey: undefined as string | undefined,
          codigo: empresaAtual.codigo,
          nome: empresaAtual.razao_social ?? empresaAtual.apelido ?? '',
          dedupKeyOwner: empresaAtual.id,
        }
      : empresaArquivadaAtualTempKey
        ? (() => {
            const arq = empresasArquivadas.find((a) => a.tempKey === empresaArquivadaAtualTempKey)!;
            return {
              empresaId: undefined as UUID | undefined,
              arquivadaTempKey: arq.tempKey as string | undefined,
              codigo: arq.codigoOriginal,
              nome: arq.razaoSocial,
              dedupKeyOwner: arq.tempKey,
            };
          })()
        : null;

    // Banco: pode estar na mesma linha ou em linha de continuação (sem código)
    if (bancoRaw && !bancoIgnorar(bancoRaw)) {
      if (!ctx) {
        avisos.push({
          tipo: 'linha_sem_codigo',
          mensagem: `Linha ${idx + 1}: banco "${bancoRaw}" sem empresa associada (linha sem código antes ou empresa não encontrada).`,
        });
        continue;
      }
      const bancoNome = nomeBancoLimpo(bancoRaw);
      empresaAtualTemBancoReal = true;
      // Pra arquivada: nunca tem banco existente (empresa nova será criada do zero)
      const existente = ctx.empresaId
        ? findContaExistente(contasExistentes, ctx.empresaId, bancoNome)
        : null;
      const dedupKey = `${ctx.dedupKeyOwner}|${normalizarString(bancoNome)}`;

      if (existente) {
        bancoAtualExistenteId = existente.id;
        bancoAtualTempKey = null;
        bancoAtualNome = bancoNome;
      } else if (bancosNovosKey.has(dedupKey)) {
        const novo = bancosNovos.find((b) => `${b.empresaId ?? b.empresaArquivadaTempKey}|${normalizarString(b.nome)}` === dedupKey);
        bancoAtualExistenteId = null;
        bancoAtualTempKey = novo?.tempKey ?? null;
        bancoAtualNome = bancoNome;
      } else {
        const tempKey = `tmp_${ctx.dedupKeyOwner}_${bancosNovos.length}`;
        bancosNovos.push({
          tempKey,
          empresaId: ctx.empresaId,
          empresaArquivadaTempKey: ctx.arquivadaTempKey,
          codigoEmpresa: ctx.codigo,
          nomeEmpresa: ctx.nome,
          nome: bancoNome,
        });
        bancosNovosKey.add(dedupKey);
        bancoAtualExistenteId = null;
        bancoAtualTempKey = tempKey;
        bancoAtualNome = bancoNome;
      }
    }

    // Status mensais
    if (!ctx || (!bancoAtualExistenteId && !bancoAtualTempKey) || !bancoAtualNome) {
      if (meses.some((m) => m && m !== '-')) {
        avisos.push({
          tipo: 'sem_banco_atual',
          mensagem: `Linha ${idx + 1}: marcações de mês encontradas sem banco atribuído (linha pulada).`,
        });
      }
      continue;
    }

    for (let i = 0; i < 12; i++) {
      const valor = (meses[i] ?? '').trim();
      if (!valor) continue;
      if (TOKEN_VAZIO.has(valor)) continue;

      const valorUpper = valor.toUpperCase();
      let status: ControleContabilStatus;
      let marcadoPorId: UUID | null = null;
      let marcadoPorNome: string | null = null;
      let observacao: string | null = null;

      const ehTextoOk = valorUpper === 'OK';
      const inicialReconhecida = ehTextoOk ? null : extrairInicial(valor, iniciaisMap);

      if (TOKEN_SEM_MOVIMENTO.has(valorUpper)) {
        status = 'sem_movimento';
        observacao = 'Importado: sem movimento';
      } else if (ehTextoOk) {
        status = 'feito';
        // sem usuário associado — só verde
      } else if (inicialReconhecida) {
        const nome = iniciaisMap[inicialReconhecida];
        const usuario = findUsuarioPorNome(usuarios, nome);
        marcadoPorNome = nome;
        marcadoPorId = usuario?.id ?? null;
        status = 'feito';
      } else {
        avisos.push({
          tipo: 'inicial_desconhecida',
          mensagem: `Empresa ${ctx.codigo} ${ctx.nome}, banco "${bancoAtualNome}", mês ${i + 1}: valor "${valor}" não reconhecido para o ano ${ano}.`,
        });
        continue;
      }

      statuses.push({
        empresaId: ctx.empresaId,
        empresaArquivadaTempKey: ctx.arquivadaTempKey,
        codigoEmpresa: ctx.codigo,
        nomeEmpresa: ctx.nome,
        bancoExistenteId: bancoAtualExistenteId ?? undefined,
        bancoTempKey: bancoAtualTempKey ?? undefined,
        bancoNome: bancoAtualNome,
        mes: `${ano}-${String(i + 1).padStart(2, '0')}`,
        status,
        marcadoPorId,
        marcadoPorNome,
        observacao,
        origemValorCsv: valor,
      });
    }
  }

  // Commit da última empresa do CSV (caso tenha banco real)
  commitTributacaoPendente();

  return {
    ano,
    tributacoes,
    bancosNovos,
    statuses,
    avisos,
    empresasNaoEncontradas,
    empresasArquivadas,
    totalLinhasCsv: linhas.length,
  };
}
