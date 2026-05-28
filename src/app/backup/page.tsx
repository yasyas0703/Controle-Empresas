'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Download, Upload, Loader2, CheckCircle, AlertTriangle, Clock, Timer, FolderOpen, X } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { exportarBackup, restaurarBackup, validarBackup, type BackupData, getAutoBackupSettings, setAutoBackupSettings, calcProximoBackup, getUltimoBackupDate, type AutoBackupSettings, salvarBackupArquivo, escolherPastaBackup, getNomePastaSalva, limparDirHandle, prepararDirHandle } from '@/lib/backup';

interface HistoricoItem {
  data: string;
  tipo: 'export' | 'restore';
  contagem: Record<string, number>;
}

const STORAGE_KEY = 'controle-triar-backup-historico';

function loadHistorico(): HistoricoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistorico(items: HistoricoItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 20)));
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

function getErrorName(error: unknown): string | null {
  if (error instanceof Error && error.name) return error.name;
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return null;
}

export default function BackupPage() {
  const { canAdmin, reloadData, mostrarAlerta } = useSistema();
  const [exportando, setExportando] = useState(false);
  const [restaurando, setRestaurando] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [backupParaRestaurar, setBackupParaRestaurar] = useState<BackupData | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [autoSettings, setAutoSettings] = useState<AutoBackupSettings>({ ativo: false, frequenciaDias: 7 });
  const [proximoBackup, setProximoBackup] = useState<Date | null>(null);
  const [ultimoBackup, setUltimoBackup] = useState<string | null>(null);
  const [pastaBackup, setPastaBackup] = useState<string | null>(null);

  useEffect(() => {
    setHistorico(loadHistorico());
    setAutoSettings(getAutoBackupSettings());
    setProximoBackup(calcProximoBackup());
    setUltimoBackup(getUltimoBackupDate());
    getNomePastaSalva().then(setPastaBackup);
  }, []);

  if (!canAdmin) {
    return (
      <div className="p-8 text-center text-gray-500">
        Acesso restrito a administradores.
      </div>
    );
  }

  const handleExportar = async () => {
    setExportando(true);
    setProgresso('');
    try {
      // Pedir permissão da pasta AGORA (durante o clique) antes de qualquer await longo
      const dirHandle = await prepararDirHandle();

      const backup = await exportarBackup(setProgresso);
      const json = JSON.stringify(backup, null, 2);
      const dataStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `backup-triar-${dataStr}.json`;
      const gravouNaPasta = await salvarBackupArquivo(json, fileName, dirHandle);

      const item: HistoricoItem = { data: backup.criadoEm, tipo: 'export', contagem: backup.contagem };
      const novo = [item, ...historico];
      setHistorico(novo);
      saveHistorico(novo);

      setUltimoBackup(backup.criadoEm);
      setProximoBackup(calcProximoBackup());

      if (gravouNaPasta) {
        setProgresso(`Backup salvo na pasta "${pastaBackup ?? 'backups'}" com sucesso!`);
        mostrarAlerta('Backup exportado', `Arquivo salvo na pasta "${pastaBackup ?? 'backups'}".`, 'sucesso');
      } else {
        setProgresso('Backup exportado com sucesso!');
        mostrarAlerta('Backup exportado', 'Arquivo JSON baixado com sucesso.', 'sucesso');
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Falha ao exportar backup.');
      setProgresso(`Erro: ${message}`);
      mostrarAlerta('Erro no backup', message, 'erro');
    } finally {
      setExportando(false);
    }
  };

  const handleSelecionarArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNomeArquivo(file.name);
    setConfirmacao('');
    setProgresso('');

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        const result = validarBackup(parsed);
        if (!result.ok) {
          setProgresso(`Arquivo inválido: ${result.erro}`);
          setBackupParaRestaurar(null);
          return;
        }
        setBackupParaRestaurar(result.backup);
        setProgresso('Arquivo válido. Confira os dados abaixo e digite RESTAURAR para confirmar.');
      } catch {
        setProgresso('Erro ao ler arquivo: JSON inválido.');
        setBackupParaRestaurar(null);
      }
    };
    reader.readAsText(file);
  };

  const handleRestaurar = async () => {
    if (!backupParaRestaurar) return;
    if (confirmacao !== 'RESTAURAR') {
      mostrarAlerta('Confirmacao necessaria', 'Digite RESTAURAR (em maiusculas) para confirmar.', 'aviso');
      return;
    }

    setRestaurando(true);
    setProgresso('');
    try {
      await restaurarBackup(backupParaRestaurar, setProgresso);
      await reloadData();

      const item: HistoricoItem = { data: new Date().toISOString(), tipo: 'restore', contagem: backupParaRestaurar.contagem };
      const novo = [item, ...historico];
      setHistorico(novo);
      saveHistorico(novo);

      setBackupParaRestaurar(null);
      setConfirmacao('');
      setNomeArquivo('');
      if (fileRef.current) fileRef.current.value = '';
      mostrarAlerta('Backup restaurado', 'Todos os dados foram restaurados com sucesso.', 'sucesso');
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Falha ao restaurar backup.');
      setProgresso(`Erro na restauracao: ${message}`);
      mostrarAlerta('Erro na restauracao', message, 'erro');
    } finally {
      setRestaurando(false);
    }
  };

  const cancelarRestauracao = () => {
    setBackupParaRestaurar(null);
    setConfirmacao('');
    setNomeArquivo('');
    setProgresso('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleToggleAuto = (ativo: boolean) => {
    const novo = { ...autoSettings, ativo };
    setAutoSettings(novo);
    setAutoBackupSettings(novo);
    setProximoBackup(calcProximoBackup());
  };

  const handleFrequencia = (dias: number) => {
    const novo = { ...autoSettings, frequenciaDias: dias };
    setAutoSettings(novo);
    setAutoBackupSettings(novo);
    setProximoBackup(calcProximoBackup());
  };

  const handleEscolherPasta = async () => {
    if (typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') {
      mostrarAlerta(
        'Navegador nao suportado',
        'Seu navegador nao suporta escolher pasta. Use o Google Chrome ou Microsoft Edge na versao mais recente.',
        'erro'
      );
      return;
    }
    try {
      const nome = await escolherPastaBackup();
      setPastaBackup(nome);
      mostrarAlerta('Pasta configurada', `Backups serao salvos na pasta "${nome}".`, 'sucesso');
    } catch (err: unknown) {
      if (getErrorName(err) === 'AbortError') return; // usuario cancelou
      console.error('[Backup] Erro ao escolher pasta:', err);
      mostrarAlerta(
        'Erro ao escolher pasta',
        `${getErrorMessage(err, 'Erro desconhecido')}. Tente usar o Google Chrome ou Edge.`,
        'erro'
      );
    }
  };

  const handleRemoverPasta = async () => {
    await limparDirHandle();
    setPastaBackup(null);
    mostrarAlerta('Pasta removida', 'Backups voltarao a ser baixados normalmente.', 'aviso');
  };

  const formatarData = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('pt-BR');
    } catch { return iso; }
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-1)] tracking-tight">Backup e Restauração</h1>
        <p className="text-[var(--text-2)] mt-1">
          Exporte seus dados como arquivo JSON para ter um backup local. Se precisar, restaure a partir de um backup anterior.
        </p>
      </div>

      {/* Exportar */}
      <div className="bg-[var(--surface-2)] rounded-[var(--radius-md)] p-6 border border-[var(--border)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-11 w-11 rounded-md bg-[var(--ok-soft)] text-[var(--ok)] flex items-center justify-center shrink-0">
            <Download size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--text-1)] tracking-tight">Exportar Backup</h2>
            <p className="text-sm text-[var(--text-2)]">Baixa um arquivo JSON com todos os dados do sistema.</p>
          </div>
        </div>
        <button
          onClick={handleExportar}
          disabled={exportando || restaurando}
          className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] px-5 py-2.5 text-sm font-semibold text-white bg-[var(--ok)] border border-[var(--ok)] hover:brightness-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exportando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {exportando ? 'Exportando...' : 'Exportar Backup'}
        </button>
      </div>

      {/* Backup Automatico */}
      <div className="bg-[var(--surface-2)] rounded-[var(--radius-md)] p-6 border border-[var(--border)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-11 w-11 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] flex items-center justify-center shrink-0">
            <Timer size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--text-1)] tracking-tight">Backup Automático</h2>
            <p className="text-sm text-[var(--text-2)]">
              Quando ativado, o sistema exporta o backup automaticamente ao abrir o app (se já passou o prazo).
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--text-1)]">Ativar backup automático</span>
            <button
              onClick={() => handleToggleAuto(!autoSettings.ativo)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoSettings.ativo ? 'bg-[var(--brand)]' : 'bg-[var(--surface-3)] border border-[var(--border)]'}`}
              aria-pressed={autoSettings.ativo}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${autoSettings.ativo ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>

          {/* Frequencia */}
          {autoSettings.ativo && (
            <>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">Frequência</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { dias: 4, label: 'A cada 4 dias' },
                    { dias: 7, label: 'Semanal' },
                    { dias: 15, label: 'Quinzenal' },
                  ].map((opt) => {
                    const active = autoSettings.frequenciaDias === opt.dias;
                    return (
                      <button
                        key={opt.dias}
                        onClick={() => handleFrequencia(opt.dias)}
                        className={`rounded-[var(--radius)] px-3 py-1.5 border font-semibold text-sm transition-colors ${
                          active
                            ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]'
                            : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Status */}
              <div className="bg-[var(--surface-3)] rounded-[var(--radius)] p-4 border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-2)]">Último backup:</span>
                  <span className="font-semibold text-[var(--text-1)] ct-num">
                    {ultimoBackup ? formatarData(ultimoBackup) : 'Nunca'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-2)]">Próximo backup automático:</span>
                  <span className="font-semibold text-[var(--brand-strong)] ct-num">
                    {proximoBackup
                      ? proximoBackup <= new Date()
                        ? 'Agora (será feito ao recarregar)'
                        : formatarData(proximoBackup.toISOString())
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Pasta de destino */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">Pasta de destino</label>
                {pastaBackup ? (
                  <div className="flex items-center gap-3 bg-[var(--ok-soft)] border border-[var(--ok)]/40 rounded-[var(--radius)] px-4 py-3">
                    <FolderOpen size={18} className="text-[var(--ok)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-[var(--text-2)]">Salvando na pasta: </span>
                      <span className="text-sm text-[var(--text-1)] font-semibold ct-num">{pastaBackup}</span>
                    </div>
                    <button
                      onClick={handleEscolherPasta}
                      className="text-xs text-[var(--ok)] hover:brightness-90 font-semibold underline transition"
                    >
                      Trocar
                    </button>
                    <button
                      onClick={handleRemoverPasta}
                      className="rounded-md p-1 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)] transition"
                      title="Remover pasta"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleEscolherPasta}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[var(--border)] rounded-[var(--radius)] text-[var(--text-2)] font-semibold hover:bg-[var(--surface-3)] hover:border-[var(--brand)] hover:text-[var(--brand-strong)] transition-colors w-full"
                  >
                    <FolderOpen size={18} />
                    Escolher pasta (ex: sua pasta &quot;backups&quot; no Drive)
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Restaurar */}
      <div className="bg-[var(--surface-2)] rounded-[var(--radius-md)] p-6 border border-[var(--border)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-11 w-11 rounded-md bg-[var(--danger-soft)] text-[var(--danger)] flex items-center justify-center shrink-0">
            <Upload size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--text-1)] tracking-tight">Restaurar Backup</h2>
            <p className="text-sm text-[var(--text-2)]">
              Faz upload de um arquivo JSON de backup e substitui TODOS os dados atuais.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">Selecionar arquivo de backup</label>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              onChange={handleSelecionarArquivo}
              disabled={restaurando}
              className="block w-full text-sm text-[var(--text-3)] file:mr-4 file:py-2 file:px-4 file:rounded-[var(--radius)] file:border file:border-[var(--border)] file:text-sm file:font-semibold file:bg-[var(--surface-3)] file:text-[var(--text-2)] hover:file:bg-[var(--surface-3)] hover:file:border-[var(--border-strong)] file:transition-colors"
            />
            {nomeArquivo && <p className="text-sm text-[var(--text-3)] mt-1">Arquivo: <span className="ct-num text-[var(--text-1)]">{nomeArquivo}</span></p>}
          </div>

          {backupParaRestaurar && (
            <>
              {/* Preview dos dados */}
              <div className="bg-[var(--surface-3)] rounded-[var(--radius)] p-4 border border-[var(--border)]">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-3">
                  Dados do backup (<span className="ct-num text-[var(--text-1)]">{formatarData(backupParaRestaurar.criadoEm)}</span>)
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                  {Object.entries(backupParaRestaurar.contagem).map(([tabela, qtd]) => (
                    <div key={tabela} className="flex justify-between bg-[var(--surface-2)] rounded-[var(--radius)] px-3 py-2 border border-[var(--border)]">
                      <span className="text-[var(--text-2)]">{tabela}</span>
                      <span className="font-bold text-[var(--text-1)] ct-num">{qtd}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Confirmacao */}
              <div className="bg-[var(--danger-soft)] rounded-[var(--radius)] p-4 border-l-4 border-[var(--danger)]">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="text-[var(--danger)] mt-0.5 shrink-0" size={18} />
                  <div>
                    <p className="text-sm text-[var(--text-1)] font-semibold">
                      ATENÇÃO: isso vai SUBSTITUIR todos os dados atuais pelos dados do backup.
                    </p>
                    <p className="text-sm text-[var(--text-2)] mt-1">
                      Digite <strong className="text-[var(--text-1)] font-semibold">RESTAURAR</strong> abaixo para confirmar:
                    </p>
                  </div>
                </div>
                <input
                  type="text"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  placeholder="Digite RESTAURAR"
                  className="ct-input mt-3 text-center text-lg font-bold tracking-widest uppercase"
                  disabled={restaurando}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleRestaurar}
                  disabled={restaurando || confirmacao !== 'RESTAURAR'}
                  className="ct-btn-danger"
                >
                  {restaurando ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {restaurando ? 'Restaurando...' : 'Restaurar Backup'}
                </button>
                <button onClick={cancelarRestauracao} disabled={restaurando} className="ct-btn-secondary">
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Progresso */}
      {progresso && (
        <div className={`rounded-[var(--radius)] p-4 border-l-4 ${progresso.startsWith('Erro') ? 'bg-[var(--danger-soft)] border-[var(--danger)]' : 'bg-[var(--brand-soft)] border-[var(--brand)]'}`}>
          <p className={`text-sm font-semibold ${progresso.startsWith('Erro') ? 'text-[var(--danger)]' : 'text-[var(--brand-strong)]'}`}>{progresso}</p>
        </div>
      )}

      {/* Historico */}
      {historico.length > 0 && (
        <div className="bg-[var(--surface-2)] rounded-[var(--radius-md)] p-6 border border-[var(--border)]">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-11 w-11 rounded-md bg-[var(--surface-3)] text-[var(--text-2)] flex items-center justify-center shrink-0">
              <Clock size={20} />
            </div>
            <h2 className="text-lg font-bold text-[var(--text-1)] tracking-tight">Histórico de Backups</h2>
          </div>
          <div className="space-y-2">
            {historico.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-3)]">
                {item.tipo === 'export' ? (
                  <CheckCircle size={16} className="text-[var(--ok)] shrink-0" />
                ) : (
                  <Upload size={16} className="text-[var(--danger)] shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-gray-900">
                    {item.tipo === 'export' ? 'Exportacao' : 'Restauracao'}
                  </span>
                  <span className="text-sm text-gray-500 ml-2">{formatarData(item.data)}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {item.contagem.empresas ?? 0} empresas
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
