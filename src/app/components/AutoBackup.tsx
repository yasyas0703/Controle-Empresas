'use client';

import { useEffect, useRef } from 'react';
import { useSistema } from '@/app/context/SistemaContext';
import { exportarBackup, isBackupVencido, salvarBackupArquivo, getNomePastaSalva } from '@/lib/backup';

const HISTORICO_KEY = 'controle-triar-backup-historico';

function salvarNoHistorico(criadoEm: string, contagem: Record<string, number>) {
  try {
    const raw = localStorage.getItem(HISTORICO_KEY);
    const items = raw ? JSON.parse(raw) : [];
    const novo = [{ data: criadoEm, tipo: 'export', contagem }, ...items];
    localStorage.setItem(HISTORICO_KEY, JSON.stringify(novo.slice(0, 20)));
  } catch { /* ignora */ }
}

export default function AutoBackup() {
  const { canAdmin, mostrarAlerta, loading, authReady } = useSistema();
  const jaRodouRef = useRef(false);

  useEffect(() => {
    if (!authReady || loading) return;
    if (!canAdmin) return;
    if (jaRodouRef.current) return;
    jaRodouRef.current = true;

    if (!isBackupVencido()) return;

    const timer = window.setTimeout(async () => {
      try {
        const backup = await exportarBackup();
        const json = JSON.stringify(backup, null, 2);
        const dataStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `backup-triar-auto-${dataStr}.json`;
        const gravouNaPasta = await salvarBackupArquivo(json, fileName);

        salvarNoHistorico(backup.criadoEm, backup.contagem);

        const nomePasta = await getNomePastaSalva();
        if (gravouNaPasta && nomePasta) {
          mostrarAlerta(
            'Backup automatico realizado',
            `Arquivo salvo na pasta "${nomePasta}" com sucesso.`,
            'sucesso'
          );
        } else {
          mostrarAlerta(
            'Backup automatico realizado',
            'O arquivo JSON foi baixado automaticamente.',
            'sucesso'
          );
        }
      } catch (err: any) {
        console.error('[AutoBackup] Erro no backup automatico:', err);
        mostrarAlerta(
          'Erro no backup automatico',
          `Nao foi possivel gerar o backup: ${err.message}`,
          'erro'
        );
      }
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [authReady, loading, canAdmin, mostrarAlerta]);

  return null;
}
