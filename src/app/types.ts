export type UUID = string;

export type Role = 'admin' | 'gerente' | 'usuario';

export interface Departamento {
  id: UUID;
  nome: string;
  criadoEm: string; // ISO
  atualizadoEm: string; // ISO
}

export interface Usuario {
  id: UUID;
  nome: string;
  email: string;
  // Usado apenas para criação/alteração via Supabase Auth (não é persistido na tabela)
  senha?: string;
  role: Role;
  departamentoId: UUID | null;
  ativo: boolean;
  criadoEm: string; // ISO
  atualizadoEm: string; // ISO
}

export type Visibilidade = 'publico' | 'departamento' | 'confidencial' | 'usuarios';

export interface DocumentoEmpresa {
  id: UUID;
  nome: string;
  validade: string; // ISO date (YYYY-MM-DD) — pode ser vazio se sem validade
  arquivoUrl?: string; // Caminho no Storage (ou URL legada)
  tagVencimento?: string;
  historicoVencimento?: HistoricoVencimentoItem[];
  departamentosIds: UUID[]; // Departamentos responsáveis pelo documento
  visibilidade: Visibilidade;
  criadoPorId?: UUID; // Quem fez o upload
  usuariosPermitidos: UUID[]; // IDs de usuários que podem ver (quando visibilidade='usuarios')
  criadoEm: string; // ISO
  atualizadoEm: string; // ISO
}

export interface RetItem {
  id: UUID;
  numeroPta: string;
  nome: string;
  vencimento: string; // ISO date
  ultimaRenovacao: string; // ISO date
  ativo: boolean; // RET ativo ou inativo
  portaria: string; // Número da portaria vinculada (max 20 chars)
  tagVencimento?: string;
  historicoVencimento?: HistoricoVencimentoItem[];
}

export interface HistoricoVencimentoItem {
  id: UUID;
  titulo: string;
  descricao?: string;
  dataEvento?: string; // ISO date (YYYY-MM-DD)
  autorId?: UUID | null;
  autorNome?: string;
  criadoEm: string; // ISO
}

export type TipoEstabelecimento = '' | 'matriz' | 'filial';
export type TipoInscricao = '' | 'CNPJ' | 'CPF' | 'MEI' | 'CEI' | 'CAEPF' | 'CNO';

export type FormaEnvio = 'whatsapp' | 'email' | 'onvio' | 'protocolo';

export const FORMAS_ENVIO: { value: FormaEnvio; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'onvio', label: 'Onvio' },
  { value: 'protocolo', label: 'Protocolo' },
];

export interface VencimentoFiscal {
  id: UUID;
  nome: string; // Nome fixo (de VENCIMENTOS_FISCAIS_NOMES)
  vencimento: string; // ISO date (YYYY-MM-DD) — vazio se ainda não definida
  arquivoUrl?: string; // caminho no Storage (opcional)
  tagVencimento?: string;
  historicoVencimento?: HistoricoVencimentoItem[];
}

/** Nomes fixos dos vencimentos fiscais que toda empresa possui. */
export const VENCIMENTOS_FISCAIS_NOMES = [
  'ICMS',
  'SPED ICMS/IPI',
  'IPI',
  'GIA-ST/DIFAL',
  'ICMS-ST/DIFAL',
  'ISS - PRESTAÇÃO DE SERVIÇOS',
  'REINF',
  'DARF-SERVIÇOS TOMADOS',
  'PIS/COFINS',
  'SPED CONTRIBUIÇÕES',
  'CSLL/IRPJ',
  'DIFERENCIAL DE ALIQUOTA',
] as const;

export type VencimentoFiscalNome = (typeof VENCIMENTOS_FISCAIS_NOMES)[number];

export interface ChecklistFiscalItem {
  id: UUID;
  empresaId: UUID;
  mes: string; // formato 'YYYY-MM'
  obrigacao: string; // nome da obrigação fiscal
  concluido: boolean;
  concluidoPorId?: UUID | null;
  concluidoPorNome?: string;
  concluidoEm?: string; // ISO
  observacao?: string;
  criadoEm: string;
  atualizadoEm: string;
}

export type ObrigacaoDepartamento = 'fiscal' | 'pessoal' | 'contabil' | 'cadastro';

export type ObrigacaoEsfera = 'federal' | 'estadual' | 'municipal' | 'interna';

export type ObrigacaoFrequencia =
  | 'mensal'
  | 'bimestral'
  | 'trimestral'
  | 'quadrimestral'
  | 'semestral'
  | 'anual'
  | 'eventual';

export type ObrigacaoTipoData = 'dia_util' | 'dia_corrido' | 'dia_fixo';

export interface Obrigacao {
  id: UUID;
  nome: string; // ex.: "DARF 2373"
  codigo?: string; // ex.: "DARF-2373"
  departamento: ObrigacaoDepartamento;
  esfera: ObrigacaoEsfera;
  frequencia: ObrigacaoFrequencia;
  // Data legal (prazo oficial)
  tipoDataLegal: ObrigacaoTipoData;
  diaDataLegal: number; // 1..31
  // Data meta (interna, normalmente antes da legal)
  tipoDataMeta: ObrigacaoTipoData;
  diaDataMeta: number; // 1..31
  // Offset da competência em relação ao mês de referência (ex.: -1 = competência é o mês anterior)
  competenciaOffset: number;
  pontuacao: number;
  agrupador?: string;
  notificarCliente: boolean;
  geraMulta: boolean;
  autoConcluir: boolean;
  palavrasChave: string[]; // para auto-detecção do PDF
  templateEmailAssunto?: string;
  templateEmailCorpo?: string;
  descricao?: string;
  empresasVinculadas: UUID[]; // empresas onde a obrigação se aplica
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface Empresa {
  id: UUID;
  cadastrada: boolean;

  // Identificação
  cnpj?: string;
  codigo: string;
  razao_social?: string;
  apelido?: string;
  data_abertura?: string;

  tipoEstabelecimento: TipoEstabelecimento;
  tipoInscricao: TipoInscricao;

  // Serviços
  servicos: string[];

  // Tags
  tags: string[];

  // RET
  possuiRet: boolean;
  rets: RetItem[];

  // Vencimentos fiscais (obrigações recorrentes do Fiscal)
  vencimentosFiscais: VencimentoFiscal[];

  // Formas de envio preferenciais (documentos/guias para o cliente)
  formaEnvio?: FormaEnvio[];

  // Inscrições / regimes
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  regime_federal?: string;
  regime_estadual?: string;
  regime_municipal?: string;

  // Endereço
  estado?: string;
  cidade?: string;
  bairro?: string;
  logradouro?: string;
  numero?: string;
  cep?: string;

  // Contato
  email?: string;
  telefone?: string;

  // Responsáveis por departamento (deptId -> userId)
  responsaveis: Record<UUID, UUID | null>;

  // Documentos
  documentos: DocumentoEmpresa[];

  // Observações / Chat interno
  observacoes: Observacao[];

  criadoEm: string; // ISO
  atualizadoEm: string; // ISO
}

export interface Observacao {
  id: UUID;
  texto: string;
  autorId: UUID;
  autorNome: string;
  criadoEm: string; // ISO
}

export type LogAction =
  | 'login'
  | 'logout'
  | 'create'
  | 'update'
  | 'delete'
  | 'alert';

export type LogEntity = 'empresa' | 'usuario' | 'departamento' | 'documento' | 'ret' | 'notificacao' | 'servico' | 'tag';

export interface LogEntry {
  id: UUID;
  em: string; // ISO
  userId: UUID | null;
  userNome?: string | null;
  action: LogAction;
  entity: LogEntity;
  entityId: UUID | null;
  message: string;
  diff?: Record<string, { from: unknown; to: unknown }>;
  deletedEm?: string | null;
  deletedById?: UUID | null;
  deletedByNome?: string | null;
}

export interface Servico {
  id: UUID;
  nome: string;
  criadoEm: string; // ISO
}

export type TagCor = 'red' | 'orange' | 'amber' | 'green' | 'emerald' | 'cyan' | 'blue' | 'violet' | 'purple' | 'pink' | 'rose' | 'slate';

export interface Tag {
  id: UUID;
  nome: string;
  cor: TagCor;
  criadoEm: string; // ISO
}

export interface SistemaState {
  empresas: Empresa[];
  usuarios: Usuario[];
  departamentos: Departamento[];
  servicos: Servico[];
  tags: Tag[];
  logs: LogEntry[];
  lixeira: LixeiraItem[];
  notificacoes: Notificacao[];
  currentUserId: UUID | null;
}

export type LixeiraTipo = 'empresa' | 'documento' | 'observacao' | 'ret';

export interface LixeiraItem {
  id: UUID;
  tipo: LixeiraTipo;
  empresa: Empresa;              // dados da empresa (quando tipo=empresa) ou empresa-pai (quando tipo=documento/observacao/ret)
  documento?: DocumentoEmpresa;  // dados do documento (quando tipo=documento)
  observacao?: Observacao;       // dados da observação (quando tipo=observacao)
  ret?: RetItem;                 // dados do RET (quando tipo=ret)
  empresaId?: UUID;              // id da empresa-pai (para restaurar doc/obs/ret)
  excluidoPorId: UUID | null;
  excluidoPorNome: string;
  excluidoEm: string; // ISO
}

export interface Notificacao {
  id: UUID;
  titulo: string;
  mensagem: string;
  tipo: 'info' | 'sucesso' | 'aviso' | 'erro';
  lida: boolean;
  criadoEm: string; // ISO
  autorId?: UUID | null;
  autorNome?: string;
  empresaId?: UUID | null;
  destinatarios?: UUID[];
}

export interface Limiares {
  critico: number;
  atencao: number;
  proximo: number;
}

export const LIMIARES_DEFAULTS: Limiares = {
  critico: 15,
  atencao: 60,
  proximo: 90,
};
