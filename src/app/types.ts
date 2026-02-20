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

export type LogEntity = 'empresa' | 'usuario' | 'departamento' | 'documento' | 'ret' | 'notificacao' | 'servico';

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

export type LixeiraTipo = 'empresa' | 'documento' | 'observacao';

export interface LixeiraItem {
  id: UUID;
  tipo: LixeiraTipo;
  empresa: Empresa;              // dados da empresa (quando tipo=empresa) ou empresa-pai (quando tipo=documento/observacao)
  documento?: DocumentoEmpresa;  // dados do documento (quando tipo=documento)
  observacao?: Observacao;       // dados da observação (quando tipo=observacao)
  empresaId?: UUID;              // id da empresa-pai (para restaurar doc/obs)
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
