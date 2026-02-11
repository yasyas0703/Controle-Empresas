export type UUID = string;

export type Role = 'gerente' | 'usuario';

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

export interface DocumentoEmpresa {
  id: UUID;
  nome: string;
  validade: string; // ISO date (YYYY-MM-DD)
  criadoEm: string; // ISO
  atualizadoEm: string; // ISO
}

export interface RetItem {
  id: UUID;
  numeroPta: string;
  nome: string;
  vencimento: string; // ISO date
  ultimaRenovacao: string; // ISO date
}

export type TipoEstabelecimento = '' | 'matriz' | 'filial';
export type TipoInscricao = '' | 'CNPJ' | 'CPF' | 'MEI' | 'CEI' | 'CAEPF' | 'CNO';

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

  // RET
  possuiRet: boolean;
  rets: RetItem[];

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

export type LogEntity = 'empresa' | 'usuario' | 'departamento' | 'documento' | 'ret';

export interface LogEntry {
  id: UUID;
  em: string; // ISO
  userId: UUID | null;
  action: LogAction;
  entity: LogEntity;
  entityId: UUID | null;
  message: string;
  diff?: Record<string, { from: unknown; to: unknown }>;
}

export interface Servico {
  id: UUID;
  nome: string;
  criadoEm: string; // ISO
}

export interface SistemaState {
  empresas: Empresa[];
  usuarios: Usuario[];
  departamentos: Departamento[];
  servicos: Servico[];
  logs: LogEntry[];
  lixeira: LixeiraItem[];
  notificacoes: Notificacao[];
  currentUserId: UUID | null;
}

export interface LixeiraItem {
  id: UUID;
  empresa: Empresa;
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
}
