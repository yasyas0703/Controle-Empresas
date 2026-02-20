'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Download, Upload, Loader2, CheckCircle, AlertTriangle, Clock, Timer, Info, FolderOpen, X } from 'lucide-react';
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
    } catch (err: any) {
      setProgresso(`Erro: ${err.message}`);
      mostrarAlerta('Erro no backup', err.message, 'erro');
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
    } catch (err: any) {
      setProgresso(`Erro na restauracao: ${err.message}`);
      mostrarAlerta('Erro na restauracao', err.message, 'erro');
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
    if (typeof (window as any).showDirectoryPicker !== 'function') {
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
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // usuario cancelou
      console.error('[Backup] Erro ao escolher pasta:', err);
      mostrarAlerta(
        'Erro ao escolher pasta',
        `${err?.message || 'Erro desconhecido'}. Tente usar o Google Chrome ou Edge.`,
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
        <h1 className="text-2xl font-bold text-gray-900">Backup e Restauracao</h1>
        <p className="text-gray-600 mt-1">
          Exporte seus dados como arquivo JSON para ter um backup local. Se precisar, restaure a partir de um backup anterior.
        </p>
      </div>

      {/* Exportar */}
      <div className="bg-white rounded-2xl shadow p-6 border border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-green-100">
            <Download className="text-green-600" size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Exportar Backup</h2>
            <p className="text-sm text-gray-500">Baixa um arquivo JSON com todos os dados do sistema.</p>
          </div>
        </div>
        <button
          onClick={handleExportar}
          disabled={exportando || restaurando}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl font-semibold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exportando ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          {exportando ? 'Exportando...' : 'Exportar Backup'}
        </button>
      </div>

      {/* Backup Automatico */}
      <div className="bg-white rounded-2xl shadow p-6 border border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-purple-100">
            <Timer className="text-purple-600" size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Backup Automatico</h2>
            <p className="text-sm text-gray-500">
              Quando ativado, o sistema exporta o backup automaticamente ao abrir o app (se ja passou o prazo).
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-700">Ativar backup automatico</span>
            <button
              onClick={() => handleToggleAuto(!autoSettings.ativo)}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${autoSettings.ativo ? 'bg-purple-600' : 'bg-gray-300'}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${autoSettings.ativo ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>

          {/* Frequencia */}
          {autoSettings.ativo && (
            <>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Frequencia</label>
                <div className="flex gap-3">
                  {[
                    { dias: 4, label: 'A cada 4 dias' },
                    { dias: 7, label: 'Semanal' },
                    { dias: 15, label: 'Quinzenal' },
                  ].map((opt) => (
                    <button
                      key={opt.dias}
                      onClick={() => handleFrequencia(opt.dias)}
                      className={`px-4 py-2 rounded-xl border-2 font-semibold text-sm transition-all ${
                        autoSettings.frequenciaDias === opt.dias
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div className="bg-purple-50 rounded-xl p-4 border border-purple-200 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Ultimo backup:</span>
                  <span className="font-semibold text-gray-900">
                    {ultimoBackup ? formatarData(ultimoBackup) : 'Nunca'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Proximo backup automatico:</span>
                  <span className="font-semibold text-purple-700">
                    {proximoBackup
                      ? proximoBackup <= new Date()
                        ? 'Agora (sera feito ao recarregar)'
                        : formatarData(proximoBackup.toISOString())
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Pasta de destino */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Pasta de destino</label>
                {pastaBackup ? (
                  <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                    <FolderOpen size={20} className="text-green-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-green-800">Salvando na pasta: </span>
                      <span className="text-sm text-green-700 font-bold">{pastaBackup}</span>
                    </div>
                    <button
                      onClick={handleEscolherPasta}
                      className="text-xs text-green-700 hover:text-green-900 font-semibold underline"
                    >
                      Trocar
                    </button>
                    <button
                      onClick={handleRemoverPasta}
                      className="text-green-600 hover:text-red-500 transition"
                      title="Remover pasta"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleEscolherPasta}
                    className="inline-flex items-center gap-2 px-4 py-3 border-2 border-dashed border-purple-300 rounded-xl text-purple-700 font-semibold hover:bg-purple-50 hover:border-purple-400 transition-all w-full justify-center"
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
      <div className="bg-white rounded-2xl shadow p-6 border border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-red-100">
            <Upload className="text-red-600" size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Restaurar Backup</h2>
            <p className="text-sm text-gray-500">
              Faz upload de um arquivo JSON de backup e substitui TODOS os dados atuais.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Selecionar arquivo de backup</label>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              onChange={handleSelecionarArquivo}
              disabled={restaurando}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100"
            />
            {nomeArquivo && <p className="text-sm text-gray-500 mt-1">Arquivo: {nomeArquivo}</p>}
          </div>

          {backupParaRestaurar && (
            <>
              {/* Preview dos dados */}
              <div className="bg-gray-50 rounded-xl p-4 border">
                <h3 className="font-semibold text-gray-700 mb-2">Dados do backup ({formatarData(backupParaRestaurar.criadoEm)})</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                  {Object.entries(backupParaRestaurar.contagem).map(([tabela, qtd]) => (
                    <div key={tabela} className="flex justify-between bg-white rounded-lg px-3 py-2 border">
                      <span className="text-gray-600">{tabela}</span>
                      <span className="font-bold text-gray-900">{qtd}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Confirmacao */}
              <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="text-red-600 mt-0.5 shrink-0" size={20} />
                  <div>
                    <p className="text-sm text-red-800 font-semibold">
                      ATENCAO: Isso vai SUBSTITUIR todos os dados atuais pelos dados do backup.
                    </p>
                    <p className="text-sm text-red-700 mt-1">
                      Digite <strong>RESTAURAR</strong> abaixo para confirmar:
                    </p>
                  </div>
                </div>
                <input
                  type="text"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  placeholder="Digite RESTAURAR"
                  className="mt-3 w-full px-4 py-3 border border-red-300 rounded-xl text-center text-lg font-bold tracking-widest uppercase"
                  disabled={restaurando}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleRestaurar}
                  disabled={restaurando || confirmacao !== 'RESTAURAR'}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-semibold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {restaurando ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                  {restaurando ? 'Restaurando...' : 'Restaurar Backup'}
                </button>
                <button
                  onClick={cancelarRestauracao}
                  disabled={restaurando}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Progresso */}
      {progresso && (
        <div className={`rounded-xl p-4 border ${progresso.startsWith('Erro') ? 'bg-red-50 border-red-200 text-red-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
          <p className="text-sm font-medium">{progresso}</p>
        </div>
      )}

      {/* Historico */}
      {historico.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-6 border border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-xl bg-gray-100">
              <Clock className="text-gray-600" size={24} />
            </div>
            <h2 className="text-lg font-bold text-gray-900">Historico de Backups</h2>
          </div>
          <div className="space-y-2">
            {historico.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-gray-50">
                {item.tipo === 'export' ? (
                  <CheckCircle size={18} className="text-green-500 shrink-0" />
                ) : (
                  <Upload size={18} className="text-red-500 shrink-0" />
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
