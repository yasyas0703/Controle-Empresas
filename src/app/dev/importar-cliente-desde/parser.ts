import type { Empresa, Tributacao, UUID } from '@/app/types';

export interface PreviewLinha {
  empresaId: UUID;
  codigo: string;
  nomeEmpresa: string;
  clienteDesdeAntes: string | null;
  clienteDesdeDepois: string;       // YYYY-MM-DD
  origemValorCsv: string;            // DD/MM/YYYY
}

// Empresa a ser CADASTRADA como já desligada (cliente antigo)
export interface PreviewDesligadaNova {
  tempKey: string;
  motivo: 'nao_encontrada' | 'codigo_reciclado';
  codigoCsv: string;
  codigoSintetico: string;        // se reciclado, fica codigoCsv-A; se não-encontrada, igual codigoCsv
  apelido: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  clienteDesde: string;           // YYYY-MM-DD
  tributacaoSugerida: Tributacao | null;
  similaridadeComCodigoExistente?: number;
  nomeEmpresaAtualNoSistema?: string; // só pra reciclado
  selecionada: boolean;
}

export interface PreviewAviso {
  tipo: 'data_invalida' | 'sem_data' | 'cabecalho';
  codigo?: string;
  mensagem: string;
}

export interface ParsedCsv {
  linhas: PreviewLinha[];
  desligadasNovas: PreviewDesligadaNova[];
  avisos: PreviewAviso[];
  totalLinhas: number;
}

const COMBINING_DIACRITICS = /[̀-ͯ]/g;
function normalizar(s: string): string {
  return s.normalize('NFD').replace(COMBINING_DIACRITICS, '').toLowerCase().trim();
}

const SUFIXOS_EMPRESA = ['ltda', 'me', 'eireli', 'epp', 'sa', 's/a', 's.a', 's/s', 's.s', 'cia', 'mei', 'inc'];

function tokenizar(nome: string): Set<string> {
  const norm = normalizar(nome).replace(/[.,;:/\-()&]/g, ' ').replace(/\s+/g, ' ').trim();
  return new Set(
    norm.split(' ').filter((t) => t.length >= 2).filter((t) => !SUFIXOS_EMPRESA.includes(t))
  );
}

function similaridade(a: string, b: string): number {
  const ta = tokenizar(a);
  const tb = tokenizar(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const SIM_MIN = 0.4;

function parseDataDDMMYYYY(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  const ano = parseInt(m[3], 10);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1900 || ano > 2200) return null;
  const d = new Date(ano, mes - 1, dia);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return `${ano.toString().padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function findEmpresa(empresas: Empresa[], codigo: string): Empresa | null {
  const alvo = codigo.replace(/\D/g, '');
  if (!alvo) return null;
  return empresas.find((e) => (e.codigo ?? '').replace(/\D/g, '') === alvo) ?? null;
}

// Mapeia o REGIME da planilha pra Tributacao do sistema. REAL/PRESUMIDO/SIMPLES viram tributação;
// CEI/MEI/OBRA/DOMESTICA viram null (não são tributações no nosso enum).
function mapearTributacao(regime: string): Tributacao | null {
  const r = normalizar(regime);
  if (r === 'real' || r === 'lucro real') return 'lucro_real';
  if (r === 'presumido' || r === 'lucro presumido') return 'lucro_presumido';
  if (r === 'simples' || r === 'simples nacional') return 'simples_nacional';
  return null;
}

function gerarCodigoSintetico(
  codigoBase: string,
  empresasExistentes: Empresa[],
  jaPlanejadas: PreviewDesligadaNova[]
): string {
  const codigosSistema = new Set(empresasExistentes.map((e) => (e.codigo ?? '').trim()));
  const codigosPlanejados = new Set(jaPlanejadas.map((d) => d.codigoSintetico));
  const sufixos = ['A', ...Array.from({ length: 99 }, (_, i) => `A${i + 2}`)];
  for (const sufixo of sufixos) {
    const candidato = `${codigoBase}-${sufixo}`;
    if (!codigosSistema.has(candidato) && !codigosPlanejados.has(candidato)) return candidato;
  }
  return `${codigoBase}-A${Date.now()}`;
}

export function parseCsvClienteDesde(csv: string, empresas: Empresa[]): ParsedCsv {
  const linhas: PreviewLinha[] = [];
  const desligadasNovas: PreviewDesligadaNova[] = [];
  const avisos: PreviewAviso[] = [];
  const linhasCsv = csv.split(/\r?\n/);

  for (let idx = 0; idx < linhasCsv.length; idx++) {
    const txt = linhasCsv[idx];
    if (!txt || !txt.includes(';')) continue;
    const cols = txt.split(';').map((c) => c.trim());

    const codigoRaw = cols[0] ?? '';
    if (!codigoRaw) continue;

    // Pula cabeçalho
    const lower = codigoRaw.toLowerCase();
    if (lower === 'codigo' || lower === 'código') {
      avisos.push({ tipo: 'cabecalho', mensagem: `Linha ${idx + 1}: cabeçalho ignorado.` });
      continue;
    }

    // CODIGO;APELIDO;CNPJ;NOME FANTASIA;RAZÃO SOCIAL;SIT;CLIENTE DESDE;REGIME
    const apelido = cols[1] ?? '';
    const cnpj = cols[2] ?? '';
    const nomeFantasia = cols[3] ?? '';
    const razaoSocial = cols[4] ?? '';
    const clienteDesdeRaw = cols[6] ?? '';
    const regime = cols[7] ?? '';

    if (!clienteDesdeRaw) {
      avisos.push({
        tipo: 'sem_data',
        codigo: codigoRaw,
        mensagem: `${codigoRaw} ${razaoSocial}: sem data preenchida — pulado.`,
      });
      continue;
    }

    const clienteDesdeIso = parseDataDDMMYYYY(clienteDesdeRaw);
    if (!clienteDesdeIso) {
      avisos.push({
        tipo: 'data_invalida',
        codigo: codigoRaw,
        mensagem: `${codigoRaw} ${razaoSocial}: data "${clienteDesdeRaw}" inválida (esperado DD/MM/YYYY).`,
      });
      continue;
    }

    const empresa = findEmpresa(empresas, codigoRaw);
    const tributacaoSugerida = mapearTributacao(regime);

    if (!empresa) {
      // Empresa que não existe no sistema → cliente antigo desligado.
      desligadasNovas.push({
        tempKey: `desl_${desligadasNovas.length}`,
        motivo: 'nao_encontrada',
        codigoCsv: codigoRaw,
        codigoSintetico: codigoRaw, // não tem conflito
        apelido,
        cnpj,
        razaoSocial,
        nomeFantasia,
        clienteDesde: clienteDesdeIso,
        tributacaoSugerida,
        selecionada: true,
      });
      continue;
    }

    // Validação de nome (detecção de código reciclado)
    const nomeSistema = empresa.razao_social ?? empresa.apelido ?? '';
    const sim = similaridade(razaoSocial || apelido || '', nomeSistema);
    if (sim < SIM_MIN && nomeSistema) {
      desligadasNovas.push({
        tempKey: `desl_${desligadasNovas.length}`,
        motivo: 'codigo_reciclado',
        codigoCsv: codigoRaw,
        codigoSintetico: gerarCodigoSintetico(codigoRaw, empresas, desligadasNovas),
        apelido,
        cnpj,
        razaoSocial,
        nomeFantasia,
        clienteDesde: clienteDesdeIso,
        tributacaoSugerida,
        similaridadeComCodigoExistente: sim,
        nomeEmpresaAtualNoSistema: nomeSistema,
        selecionada: true,
      });
      continue;
    }

    linhas.push({
      empresaId: empresa.id,
      codigo: empresa.codigo,
      nomeEmpresa: nomeSistema || razaoSocial,
      clienteDesdeAntes: empresa.cliente_desde ?? null,
      clienteDesdeDepois: clienteDesdeIso,
      origemValorCsv: clienteDesdeRaw,
    });
  }

  return { linhas, desligadasNovas, avisos, totalLinhas: linhasCsv.length };
}
