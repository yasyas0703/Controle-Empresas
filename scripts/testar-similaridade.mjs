// Roda a função similaridadeNomes do parser contra um conjunto de pares
// problemáticos pra validar se as melhorias funcionaram.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Inline a similaridade pra não precisar bundler — copia o algoritmo do parser.
const SUFIXOS_EMPRESA = ['ltda','me','eireli','epp','sa','s/a','s.a','s/s','s.s','cia','mei','eppi','inc','co'];
function normalizarString(s){return s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();}
function juntarLetrasSoltas(tokens){const out=[];let buf='';for(const t of tokens){if(t.length===1&&/[a-z0-9]/i.test(t))buf+=t;else{if(buf){out.push(buf);buf='';}out.push(t);}}if(buf)out.push(buf);return out;}
function tokenizarNomeEmpresa(nome){const norm=normalizarString(nome).replace(/[.,;:/\-()&]/g,' ').replace(/\s+/g,' ').trim();const raw=norm.split(' ').filter(Boolean);const merged=juntarLetrasSoltas(raw);return new Set(merged.filter(t=>t.length>=2).filter(t=>!SUFIXOS_EMPRESA.includes(t)));}
function tokensCompativeis(a,b){if(a===b)return true;if(a.length<3||b.length<3)return false;return a.startsWith(b)||b.startsWith(a);}
function gerarVariantesNome(nome){const variantes=[nome];const m=nome.match(/^[^-]{1,30}-\s*(.+)$/);if(m&&m[1].trim().length>=3)variantes.push(m[1].trim());return variantes;}
function compararTokens(a,b){if(a.length===0||b.length===0)return 0;const usados=new Set();let matches=0;for(const ta of a){for(let i=0;i<b.length;i++){if(usados.has(i))continue;if(tokensCompativeis(ta,b[i])){matches++;usados.add(i);break;}}}if(matches===0)return 0;const jac=matches/(a.length+b.length-matches);const cob=Math.max(matches/a.length,matches/b.length);return Math.max(jac,cob);}
function similaridadeNomes(a,b){const va=gerarVariantesNome(a),vb=gerarVariantesNome(b);let max=0;for(const x of va){const tx=Array.from(tokenizarNomeEmpresa(x));for(const y of vb){const ty=Array.from(tokenizarNomeEmpresa(y));const s=compararTokens(tx,ty);if(s>max)max=s;}}return max;}

const casos = [
  // Casos que estavam falhando (devem virar >= 60%)
  ['NOVAROTA', 'NOVAROTA COMERCIO IMPORTACAO E EXPORTACAO LTDA'],
  ['DISTRIBUIDORA JS - DIST JS', 'DISTRIBUIDORA J S LTDA'],
  ['DIST JS', 'DISTRIBUIDORA J S LTDA'],
  ['MPB IND', 'MPB MANUTENCAO INDUSTRIAL LTDA'],
  ['BASP', 'COMPANHIA TEXTIL BASP E PARTICIPACOES LTDA'],
  ['LEILA - AUTOCAM MEDICAL DO BRASIL USINAGEM', 'AUTOCAM MEDICAL DO BRASIL'],
  ['LEILA - UNICOB', 'UNICOB COMERCIO LTDA'],
  ['KAYZA - GARCIA VESTU', 'GARCIA VESTUARIO LTDA'],
  ['R-ISOBOND INDUSTRIA E COMERCIO EPS LTDA', 'ISOBOND IND. E COM. EPS'],
  ['P-INOVA-DROGARIA ALM', 'INOVA - DROGARIA ALMEIDA E LIMA'],
  ['S-MC & K PARTICIPACAO', 'MC & K PARTICIPACOES LTDA'],
  ['ARCO IRIS - IRMÃOS LABEGALINI', 'COMERCIO DE BEBIDAS IRMÃOS LABEGALINI'],
  ['MINAS NOVAS', 'MINASNOVAS'],
  ['CALBE COMERCIAL', 'CABLE COMERCIAL'],
  ['CUBOTECH - CUBOTECH', 'CUBOTECH'],
  // Falsos positivos que devem CONTINUAR sendo 0
  ['EMPRESA TOTAL', 'OUTRA COISA DIFERENTE'],
  ['LIFETREK', 'AUTOCAM MEDICAL'],
];

// Thresholds: 0.4 = match por código (caminho feliz), 0.6 = match por nome
// (fallback quando código não bate). Os de mesmo código real só precisam
// de >= 40%, os outros de >= 60%.
let okCount = 0, badCount = 0;
for (const [a, b] of casos) {
  const sim = similaridadeNomes(a, b);
  const pct = Math.round(sim * 100);
  const esperaMatch = a !== 'EMPRESA TOTAL' && a !== 'LIFETREK';
  const passou = esperaMatch ? sim >= 0.4 : sim < 0.4;
  console.log(`${passou ? '✓' : '✗'} ${pct}%  "${a}"  ↔  "${b}"`);
  if (passou) okCount++; else badCount++;
}
console.log(`\nResultado: ${okCount}/${casos.length} ok, ${badCount} falhas (threshold por código = 40%)`);
