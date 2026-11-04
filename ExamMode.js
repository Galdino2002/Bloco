import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Image, PanResponder, Pressable, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, View, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import Svg, { Path, Rect } from 'react-native-svg';
import { distanceToSegment, eraseAtPoint, getHighlighterStyle, pathIntersectsPolygon, screenToDocument } from './drawing';
import { commitHistory, createHistory, redoHistory, undoHistory } from './drawingHistory';
import { ContextToolbar, design, IconButton, ScreenHeader } from './designSystem';

const STORAGE_KEY = '@bloco:exams:v1';
const BACKUP_KEY = '@bloco:exams:backup:v1';

async function writeExamsWithBackup(items) {
  const previous = await AsyncStorage.getItem(STORAGE_KEY);
  if (previous) {
    try { if (Array.isArray(JSON.parse(previous))) await AsyncStorage.setItem(BACKUP_KEY, previous); } catch { /* preserve the last known good backup */ }
  }
  const serialized = JSON.stringify(items);
  await AsyncStorage.setItem(STORAGE_KEY, serialized);
}

const DIR = FileSystem.documentDirectory + 'bloco-exams/';
const GREEN = '#315C49';
const INK = '#203B32';
const PAPER = '#F7F6F1';
const LINE = '#E7E8E1';
const COLORS = ['#202124','#5F6368','#B3261E','#E67C73','#E8710A','#F9AB00','#188038','#34A853','#00796B','#12A594','#1A73E8','#4285F4','#3F51B5','#673AB7','#A142F4','#D81B60','#8D6E63','#FFFFFF'];

const EXAMS = [
  { id: 'URCA', name: 'URCA', description: 'Universidade Regional do Cariri', duration: 4 * 60 * 60, durationLabel: '4 horas' },
  { id: 'UECE', name: 'UECE', description: 'Universidade Estadual do Ceará', duration: 4 * 60 * 60, durationLabel: '4 horas por prova/fase' },
  { id: 'ENEM1', name: 'ENEM · 1º dia', description: 'Linguagens, Ciências Humanas e Redação', duration: 5 * 60 * 60 + 30 * 60, durationLabel: '5 horas e 30 minutos' },
  { id: 'ENEM2', name: 'ENEM · 2º dia', description: 'Matemática e Ciências da Natureza', duration: 5 * 60 * 60, durationLabel: '5 horas' },
];

const PDF_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:#fff}</style></head><body>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script>
<script>
function send(o){window.ReactNativeWebView.postMessage(JSON.stringify(o));}
if(typeof pdfjsLib==='undefined'){send({type:'ERROR',message:'Não foi possível carregar o mecanismo de PDF. Verifique a conexão com a internet.'});}else{
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
async function loadPdf(base64){
 try{
  const raw=atob(base64);const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
  send({type:'START',total:pdf.numPages});
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n);const viewport=page.getViewport({scale:1.35});
   const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
   const data=canvas.toDataURL('image/jpeg',0.82).split(',')[1];
   send({type:'PAGE',number:n,total:pdf.numPages,data});
   canvas.width=0;canvas.height=0;
  }
  send({type:'DONE'});
 }catch(e){send({type:'ERROR',message:String(e&&e.message||e)});}
}
document.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='LOAD_PDF')loadPdf(m.data);});
window.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='LOAD_PDF')loadPdf(m.data);});
send({type:'READY'});
}
<\/script></body></html>`;

function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}
function svgPath(points, close = false) {
  if (!points || !points.length) return '';
  return points.map((p, i) => (i ? 'L ' : 'M ') + p.x + ' ' + p.y).join(' ') + (close ? ' Z' : '');
}
function eraseWholeStrokesAtPoint(strokes, point, radius) {
  return strokes.filter(stroke => {
    const points = stroke.points || [];
    if (!points.length) return false;
    if (points.length === 1) return Math.hypot(points[0].x - point.x, points[0].y - point.y) >= radius;
    return !points.some((current, index) => index > 0 && distanceToSegment(point, points[index - 1], current) < radius);
  });
}
function boundsFor(strokes) {
  const pts = strokes.flatMap(stroke => stroke.points || []);
  if (!pts.length) return null;
  return { minX:Math.min(...pts.map(p=>p.x)), minY:Math.min(...pts.map(p=>p.y)), maxX:Math.max(...pts.map(p=>p.x)), maxY:Math.max(...pts.map(p=>p.y)) };
}
function rotateSelected(strokes, ids, angle) {
  const box=boundsFor(strokes.filter(stroke=>ids.includes(stroke.id)));
  if(!box)return strokes;
  const cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2;
  return strokes.map(stroke=>ids.includes(stroke.id)?{...stroke,points:stroke.points.map(p=>{const x=p.x-cx,y=p.y-cy;return{x:cx+x*Math.cos(angle)-y*Math.sin(angle),y:cy+x*Math.sin(angle)+y*Math.cos(angle)}})}:stroke);
}
function scaleSelected(strokes, ids, factor) {
  const box = boundsFor(strokes.filter(stroke => ids.includes(stroke.id)));
  if (!box) return strokes;
  const cx=(box.minX+box.maxX)/2, cy=(box.minY+box.maxY)/2;
  return strokes.map(stroke => ids.includes(stroke.id) ? {...stroke,width:stroke.width*factor,points:stroke.points.map(p=>({x:cx+(p.x-cx)*factor,y:cy+(p.y-cy)*factor}))} : stroke);
}
function Button({ title, onPress, secondary = false, disabled = false }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.buttonSecondary, disabled && { opacity: 0.4 }, pressed && { opacity: 0.75 }]}><Text style={[s.buttonText, secondary && s.buttonTextSecondary]}>{title}</Text></Pressable>;
}

export default function ExamMode({ onExit }) {
  const [saved, setSaved] = useState([]);
  const [savedSearch, setSavedSearch] = useState('');
  const [savedFilter, setSavedFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [active, setActive] = useState(null);
  const [stage, setStage] = useState('choose');
  const [, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [webReady, setWebReady] = useState(false);
  const [pdfBase64, setPdfBase64] = useState(null);
  const webRef = useRef(null);
  const pagesRef = useRef([]);

  useEffect(() => { loadSaved(); }, []);
  const loadSaved = async () => {
    try {
      let items;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) throw new Error('Armazenamento inválido');
        items = parsed;
      } catch (error) {
        const backupRaw = await AsyncStorage.getItem(BACKUP_KEY);
        if (!backupRaw) throw error;
        const backup = JSON.parse(backupRaw);
        if (!Array.isArray(backup)) throw error;
        await AsyncStorage.setItem(STORAGE_KEY, backupRaw);
        items = backup;
        Alert.alert('Provas recuperadas', 'O Bloco restaurou suas provas a partir do backup automático.');
      }
      setSaved(items.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)));
    } catch {
      Alert.alert('Erro ao carregar provas', 'Não foi possível ler as provas salvas neste aparelho.');
    }
  };
  const persist = async (items) => {
    await writeExamsWithBackup(items);
    setSaved(items);
  };

  const startImport = async () => {
    if (!selected) return;
    try {
      // Usa o seletor nativo da API File do Expo. Ele retorna um File com
      // a permissão de leitura concedida pelo Android para o documento escolhido.
      const result = await File.pickFileAsync({ mimeTypes: ['application/pdf'], multipleFiles: false });
      if (result.canceled || !result.result) return;
      const selectedPdf = result.result;
      if (selectedPdf.size > 45 * 1024 * 1024) {
        Alert.alert('PDF muito grande', 'Por enquanto, selecione um PDF de até 45 MB para evitar falta de memória no celular.');
        return;
      }
      setBusy(true); setStage('converting'); setProgress({ done: 0, total: 0 });
      if (!selectedPdf.exists) {
        throw new Error('O Android retornou o documento, mas não concedeu acesso de leitura. Tente selecionar um PDF salvo localmente em Downloads.');
      }
      if (selectedPdf.size === 0) {
        throw new Error('O PDF selecionado está vazio ou não pôde ser lido.');
      }
      const base64 = await selectedPdf.base64();
      if (!base64 || base64.length < 100) {
        throw new Error('O conteúdo do PDF veio vazio ou incompleto.');
      }
      setPdfBase64(base64);
    } catch (error) {
      setBusy(false); setStage('setup');
      Alert.alert('Não foi possível abrir o PDF', error?.message || 'Tente selecionar o arquivo novamente.');
    }
  };

  useEffect(() => {
    if (webReady && pdfBase64 && webRef.current) {
      webRef.current.postMessage(JSON.stringify({ type: 'LOAD_PDF', data: pdfBase64 }));
      setWebReady(false);
    }
  }, [webReady, pdfBase64]);

  const onPdfMessage = async (event) => {
    let message;
    try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (message.type === 'READY') { setWebReady(true); return; }
    if (message.type === 'START') { setProgress({ done: 0, total: message.total }); return; }
    if (message.type === 'PAGE') {
      try {
        await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
        const examId = pagesRef.current.examId;
        const path = DIR + examId + '-page-' + message.number + '.jpg';
        await FileSystem.writeAsStringAsync(path, message.data, { encoding: FileSystem.EncodingType.Base64 });
        pagesRef.current.items[message.number - 1] = { id: 'page-' + message.number, uri: path, paths: [] };
        setProgress({ done: message.number, total: message.total });
      } catch (error) {
        setBusy(false); setStage('setup'); setPdfBase64(null);
        Alert.alert('Erro ao salvar página', error?.message || 'Não foi possível armazenar as páginas do PDF.');
      }
      return;
    }
    if (message.type === 'ERROR') {
      setBusy(false); setStage('setup'); setPdfBase64(null);
      Alert.alert('Erro ao converter PDF', 'Não foi possível ler este arquivo. Verifique se ele não está protegido por senha e tente novamente. ' + message.message);
      return;
    }
    if (message.type === 'DONE') {
      const exam = {
        id: pagesRef.current.examId,
        title: selected.name,
        examType: selected.id,
        duration: selected.duration,
        remaining: selected.duration,
        endAt: Date.now() + selected.duration * 1000,
        elapsed: 0,
        pages: pagesRef.current.items,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'Em andamento',
      };
      try {
        const next = [exam, ...saved];
        await persist(next);
        setActive(exam); setStage('editor');
      } catch (error) {
        Alert.alert('Erro ao salvar prova', error?.message || 'Não foi possível salvar a prova.');
        setStage('setup');
      }
      setBusy(false); setPdfBase64(null);
    }
  };

  const beginConversion = async () => {
    pagesRef.current = { examId: String(Date.now()), items: [] };
    await startImport();
  };

  const saveExam = async (exam) => {
    const updated = { ...exam, updatedAt: Date.now() };
    // Lê a versão mais recente do armazenamento para não sobrescrever
    // alterações feitas pelo salvamento automático do editor.
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const current = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(current) ? current : [];
    const next = list.some(item => item.id === exam.id)
      ? list.map(item => item.id === exam.id ? updated : item)
      : [updated, ...list];
    await persist(next);
    setActive(null);
    setStage('choose');
  };
  const resumeExam = (exam) => { setActive(exam); setStage('editor'); };

  const filteredSaved = useMemo(() => {
    const query = savedSearch.trim().toLocaleLowerCase('pt-BR');
    return saved.filter(exam => {
      const matchesQuery = !query || String(exam.title || '').toLocaleLowerCase('pt-BR').includes(query);
      const status = exam.status || 'Em andamento';
      const matchesFilter = savedFilter === 'all'
        || (savedFilter === 'active' && status !== 'Finalizada')
        || (savedFilter === 'finished' && status === 'Finalizada');
      return matchesQuery && matchesFilter;
    });
  }, [saved, savedSearch, savedFilter]);
  const deleteExam = (exam) => Alert.alert('Excluir prova?', 'O registro e as anotações salvas serão removidos.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Excluir', style: 'destructive', onPress: async () => {
      try {
        for (const page of exam.pages || []) await FileSystem.deleteAsync(page.uri, { idempotent: true });
        await persist(saved.filter(item => item.id !== exam.id));
      } catch (e) { Alert.alert('Erro', 'Não foi possível excluir todos os arquivos da prova.'); }
    } },
  ]);

  if (stage === 'editor' && active) {
    return <ExamEditor exam={active} onSave={saveExam} onBack={() => saveExam(active)} />;
  }

  return <SafeAreaView style={s.safe}>
    <StatusBar barStyle="dark-content" backgroundColor={PAPER} />
    <View style={{ paddingHorizontal: 18, paddingTop: 8 }}><ScreenHeader eyebrow="BLOCO · SIMULADOS" title="Ambiente de provas" subtitle="Escolha uma prova e organize seu tempo" onBack={onExit} /></View>
    {stage === 'choose' && <ScrollView contentContainerStyle={s.content}>
      <Text style={s.section}>Escolha o exame</Text>
      {EXAMS.map(exam => <Pressable key={exam.id} onPress={() => { setSelected(exam); setStage('setup'); }} style={({ pressed }) => [s.examCard, pressed && { opacity: 0.75 }]}><View style={s.examBadge}><Text style={s.examBadgeText}>{exam.id.startsWith('ENEM') ? 'ENEM' : exam.id}</Text></View><View style={{ flex: 1 }}><Text style={s.examTitle}>{exam.name}</Text><Text style={s.examDescription}>{exam.description}</Text><Text style={s.examDuration}>Tempo: {exam.durationLabel}</Text></View><Text style={s.chevron}>›</Text></Pressable>)}
      <View style={s.savedHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[s.section, { marginTop: 24, marginBottom: 4 }]}>Suas provas</Text>
          <Text style={s.savedSummary}>{saved.length} {saved.length === 1 ? 'prova salva' : 'provas salvas'} neste aparelho</Text>
        </View>
      </View>
      {saved.length > 0 && <>
        <View style={s.searchBox}>
          <Text style={s.searchGlyph}>⌕</Text>
          <TextInput
            value={savedSearch}
            onChangeText={setSavedSearch}
            placeholder="Buscar prova pelo nome"
            placeholderTextColor="#89938A"
            style={s.searchInput}
            returnKeyType="search"
          />
          {!!savedSearch && <Pressable onPress={() => setSavedSearch('')}><Text style={s.clearSearch}>Limpar</Text></Pressable>}
        </View>
        <View style={s.filterRow}>
          {[{ id: 'all', label: 'Todas' }, { id: 'active', label: 'Em andamento' }, { id: 'finished', label: 'Finalizadas' }].map(item =>
            <Pressable key={item.id} onPress={() => setSavedFilter(item.id)} style={[s.filterChip, savedFilter === item.id && s.filterChipActive]}>
              <Text style={[s.filterChipText, savedFilter === item.id && s.filterChipTextActive]}>{item.label}</Text>
            </Pressable>
          )}
        </View>
      </>}
      {!saved.length ? <View style={s.empty}><Text style={s.emptyTitle}>Nenhuma prova salva</Text><Text style={s.emptyText}>Depois de importar um PDF, sua prova ficará disponível aqui para continuar de onde parou.</Text></View>
        : !filteredSaved.length ? <View style={s.empty}><Text style={s.emptyTitle}>Nenhuma prova encontrada</Text><Text style={s.emptyText}>Tente mudar a busca ou o filtro selecionado.</Text></View>
        : filteredSaved.map(exam => {
          const duration = Math.max(1, Number(exam.duration) || 1);
          const remainingTime = Math.max(0, Number(exam.remaining) || 0);
          const progress = Math.max(0, Math.min(100, ((duration - remainingTime) / duration) * 100));
          const status = exam.status || 'Em andamento';
          return <View key={exam.id} style={s.savedCard}>
            <Pressable onPress={() => resumeExam(exam)} style={{ flex: 1 }}>
              <View style={s.savedCardTop}>
                <Text style={s.examTitle}>{exam.title}</Text>
                <Text style={[s.statusPill, status === 'Finalizada' ? s.statusFinished : status === 'Pausada' ? s.statusPaused : s.statusActive]}>{status}</Text>
              </View>
              <Text style={s.examDescription}>{exam.pages?.length || 0} páginas · {formatTime(remainingTime)} restantes</Text>
              <View style={s.savedProgressTrack}><View style={[s.savedProgressFill, { width: progress + '%' }]} /></View>
              <Text style={s.savedMeta}>Última atividade: {new Date(exam.updatedAt || exam.createdAt || Date.now()).toLocaleDateString('pt-BR')}</Text>
            </Pressable>
            <Pressable onPress={() => deleteExam(exam)} style={s.delete}><Text style={s.deleteText}>Excluir</Text></Pressable>
          </View>;
        })}
    </ScrollView>}
    {stage === 'setup' && selected && <View style={s.setup}>
      <Text style={s.kicker}>PROVA SELECIONADA</Text><Text style={s.setupTitle}>{selected.name}</Text><Text style={s.setupDescription}>{selected.description}</Text>
      <View style={s.timerCard}><Text style={s.timerLabel}>TEMPO DISPONÍVEL</Text><Text style={s.timerPreview}>{formatTime(selected.duration)}</Text><Text style={s.timerFoot}>{selected.durationLabel}</Text></View>
      <Text style={s.setupHint}>Agora selecione o PDF da prova. O Bloco vai transformar cada página em imagem para você escrever e desenhar diretamente nela.</Text>
      <Button title="Selecionar PDF da prova" onPress={beginConversion} /><Button title="Voltar aos exames" secondary onPress={() => setStage('choose')} />
    </View>}
    {stage === 'converting' && <View style={s.converting}><ActivityIndicator size="large" color={GREEN} /><Text style={s.convertingTitle}>Preparando sua prova</Text><Text style={s.convertingText}>{progress.total ? `Convertendo página ${progress.done} de ${progress.total}` : 'Lendo o PDF...'}</Text>{progress.total > 0 && <View style={s.progressTrack}><View style={[s.progressFill, { width: (progress.done / progress.total * 100) + '%' }]} /></View>}<Text style={s.smallNote}>Mantenha o aplicativo aberto durante a conversão.</Text></View>}
    {stage === 'converting' && <View style={{ width: 1, height: 1, opacity: 0 }}><WebView ref={webRef} originWhitelist={['*']} source={{ html: PDF_HTML }} javaScriptEnabled domStorageEnabled onMessage={onPdfMessage} /></View>}
  </SafeAreaView>;
}

function ExamEditor({ exam, onSave, onBack }) {
  const [pages, setPages] = useState(exam.pages || []);
  const [index, setIndex] = useState(Math.min(exam.currentPage || 0, Math.max(0, (exam.pages?.length || 1) - 1)));
  const initialPage = exam.pages?.[Math.min(exam.currentPage || 0, Math.max(0, (exam.pages?.length || 1) - 1))] || exam.pages?.[0];
  const [paths, setPaths] = useState(initialPage?.paths || []);
  const [, setRedo] = useState([]);
  const [pathHistory, setPathHistory] = useState(() => createHistory(initialPage?.paths || []));
  const [tool, setTool] = useState('pen');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedClipboard, setSelectedClipboard] = useState([]);
  const [lasso, setLasso] = useState([]);
  const [color, setColor] = useState(COLORS[0]);
  const [markerType, setMarkerType] = useState('classic');
  const [markerWidth, setMarkerWidth] = useState(18);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [penWidth, setPenWidth] = useState(4);
  const [penOpacity, setPenOpacity] = useState(1);
  const [eraserSize, setEraserSize] = useState(24);
  const [eraserMode, setEraserMode] = useState('partial');
  const [zoom, setZoom] = useState(exam.zoom || 1);
  const [pan, setPan] = useState(exam.pan || { x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [remaining, setRemaining] = useState(exam.remaining ?? exam.duration);
  const [finished, setFinished] = useState(false);
  const [finalized, setFinalized] = useState(exam.status === 'Finalizada');
  const finalizedRef = useRef(exam.status === 'Finalizada');
  const [saveState, setSaveState] = useState('saved');
  const [paused, setPaused] = useState(exam.status === 'Pausada');
  const remainingRef = useRef(remaining);
  const endAtRef = useRef(exam.endAt || (Date.now() + remaining * 1000));
  const endAt = endAtRef.current;
  const activePath = useRef(null);
  const pathsRef = useRef(paths);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const markerTypeRef = useRef(markerType);
  const markerWidthRef = useRef(markerWidth);
  const penWidthRef = useRef(penWidth);
  const penOpacityRef = useRef(penOpacity);
  const eraserSizeRef = useRef(eraserSize);
  const eraserModeRef = useRef(eraserMode);
  const zoomRef = useRef(exam.zoom || 1);
  const pinchStart = useRef(null);
  const panStart = useRef(null);
  const panRef = useRef(exam.pan || { x: 0, y: 0 });
  const canvasSizeRef = useRef(canvasSize);
  const selectedRef = useRef([]);
  const lassoRef = useRef([]);
  const selectionGesture = useRef(null);
  const pathHistoryRef = useRef(pathHistory);
  const persistenceQueueRef = useRef(Promise.resolve());
  finalizedRef.current = finalized;
  pathsRef.current = paths; toolRef.current = tool; colorRef.current = color; markerTypeRef.current = markerType; markerWidthRef.current = markerWidth; penWidthRef.current = penWidth; penOpacityRef.current = penOpacity; eraserSizeRef.current = eraserSize; eraserModeRef.current = eraserMode;
  selectedRef.current = selectedIds; lassoRef.current = lasso;
  pathHistoryRef.current = pathHistory;
  canvasSizeRef.current = canvasSize;

  const applyPathChange = (nextPaths) => {
    pathsRef.current = nextPaths;
    setPaths(nextPaths);
    const nextHistory = commitHistory(pathHistoryRef.current, nextPaths);
    pathHistoryRef.current = nextHistory;
    setPathHistory(nextHistory);
    setRedo([]);
  };

  const recordPathSnapshot = () => {
    if (JSON.stringify(pathHistoryRef.current.present) === JSON.stringify(pathsRef.current)) return;
    const nextHistory = commitHistory(pathHistoryRef.current, pathsRef.current);
    pathHistoryRef.current = nextHistory;
    setPathHistory(nextHistory);
    setRedo([]);
  };

  const snapshotRef = useRef({ pages, index, paths, remaining, zoom, pan });
  snapshotRef.current = { pages, index, paths, remaining, zoom, pan };
  remainingRef.current = remaining;
  useEffect(() => {
    if (paused || finalized) return undefined;
    const id = setInterval(() => {
      const next = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setRemaining(next);
    }, 1000);
    return () => clearInterval(id);
  }, [endAt, paused, finalized]);
  useEffect(() => { if (remaining <= 0) setFinished(true); }, [remaining]);
  const persistLatestSnapshot = () => {
    setSaveState('saving');
    const snapshot = snapshotRef.current;
    const currentPages = snapshot.pages.map((page, pageIndex) =>
      pageIndex === snapshot.index ? { ...page, paths: snapshot.paths } : page
    );
    const elapsed = Math.max(0, exam.duration - snapshot.remaining);
    const status = finalized ? 'Finalizada' : (paused ? 'Pausada' : (snapshot.remaining <= 0 ? 'Tempo encerrado' : 'Em andamento'));
    persistenceQueueRef.current = persistenceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        const list = Array.isArray(parsed) ? parsed : [];
        const next = list.map(item => item.id === exam.id
          ? { ...item, pages: currentPages, currentPage: snapshot.index, zoom: snapshot.zoom, pan: snapshot.pan, remaining: snapshot.remaining, endAt: endAtRef.current, elapsed, status, updatedAt: Date.now() }
          : item);
        await writeExamsWithBackup(next);
        setSaveState('saved');
      })
      .catch(error => {
        setSaveState('error');
        console.error('Erro no salvamento automático da prova:', error);
      });
  };

  const persistLatestSnapshotRef = useRef(persistLatestSnapshot);
  persistLatestSnapshotRef.current = persistLatestSnapshot;

  // Protege anotações recentes: salva após pequenas pausas na edição,
  // sem esperar exclusivamente pelo intervalo periódico de 10 segundos.
  useEffect(() => {
    const timeout = setTimeout(() => persistLatestSnapshotRef.current(), 850);
    return () => clearTimeout(timeout);
  }, [pages, index, paths, zoom, pan, paused, finalized]);

  // Salvamento periódico também atualiza o cronômetro mesmo sem interação.
  useEffect(() => {
    const id = setInterval(() => persistLatestSnapshotRef.current(), 10000);
    return () => clearInterval(id);
  }, [exam.id, exam.duration, finalized, paused]);

  const persistExamState = (state = {}) => {
    const currentPages = pages.map((page, pageIndex) => pageIndex === index
      ? { ...page, paths: pathsRef.current }
      : page);
    const nextRemaining = state.remaining ?? remainingRef.current;
    const nextEndAt = state.endAt ?? endAtRef.current;
    const nextStatus = state.status || (finalized ? 'Finalizada' : (paused ? 'Pausada' : 'Em andamento'));
    const elapsed = Math.max(0, exam.duration - nextRemaining);
    persistenceQueueRef.current = persistenceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const next = list.map(item => item.id === exam.id
          ? { ...item, pages: currentPages, currentPage: index, zoom, pan, remaining: nextRemaining, endAt: nextEndAt, elapsed, status: nextStatus, updatedAt: Date.now() }
          : item);
        await writeExamsWithBackup(next);
      })
      .catch(error => console.error('Erro ao persistir estado da prova:', error));
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !finalizedRef.current,
    onMoveShouldSetPanResponder: e => !finalizedRef.current && ((e.nativeEvent.touches?.length || 0) >= 2 || true),
    onPanResponderGrant: e => {
      const touches = e.nativeEvent.touches || [];
      if (touches.length >= 2) {
        activePath.current = null;
        selectionGesture.current = null;
        lassoRef.current = []; setLasso([]);
        panStart.current = null;
        const [a, b] = touches;
        pinchStart.current = {
          distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
          zoom: zoomRef.current,
          centerX: (a.pageX + b.pageX) / 2,
          centerY: (a.pageY + b.pageY) / 2,
          pan: { ...panRef.current },
        };
        return;
      }
      if (toolRef.current === 'select') {
        activePath.current = null;
        const point = screenToDocument({ x:e.nativeEvent.locationX, y:e.nativeEvent.locationY }, { zoom: zoomRef.current, pan: panRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2} });
        const box = selectedRef.current.length ? boundsFor(pathsRef.current.filter(stroke => selectedRef.current.includes(stroke.id))) : null;
        const center = box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : point;
        const handle = box ? { x: box.maxX + 7, y: box.maxY + 7 } : point;
        const nearHandle = !!box && Math.hypot(point.x - handle.x, point.y - handle.y) < 28;
        const insideSelection = !!box && point.x >= box.minX - 14 && point.x <= box.maxX + 14 && point.y >= box.minY - 14 && point.y <= box.maxY + 14;
        if (nearHandle) {
          selectionGesture.current = { type: 'resize', startDistance: Math.max(1, Math.hypot(handle.x - center.x, handle.y - center.y)), center, original: pathsRef.current, factor: 1 };
        } else if (insideSelection) {
          selectionGesture.current = { type: 'move', start: point, original: pathsRef.current };
        } else {
          selectedRef.current = [];
          setSelectedIds([]);
          selectionGesture.current = { type: 'lasso' };
          lassoRef.current = [point];
          setLasso([point]);
        }
        return;
      }
      if (toolRef.current === 'move') {
        activePath.current = null;
        panStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, pan: panRef.current };
        return;
      }
      if (toolRef.current === 'eraser') {
        const p = screenToDocument({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }, { zoom: zoomRef.current, pan: panRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2} });
        const previous = pathsRef.current;
        const next = eraserModeRef.current === 'whole'
          ? eraseWholeStrokesAtPoint(previous, p, eraserSizeRef.current)
          : eraseAtPoint(previous, p, eraserSizeRef.current);
        const changed = next.length !== previous.length || next.some((path, index) => path !== previous[index]);
        if (changed) {
          pathsRef.current = next;
          setPaths(next);
          setRedo([]);
        }
        return;
      }
      const p = screenToDocument({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }, { zoom: zoomRef.current, pan: panRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2} });
      const isHighlighter = toolRef.current === 'highlighter';
      const marker = markerTypeRef.current;
      const markerStyle = getHighlighterStyle(marker, markerWidthRef.current);
      const stroke = {
        id: String(Date.now()) + Math.random(),
        points: [p],
        color: colorRef.current,
        width: isHighlighter ? markerStyle.width : penWidthRef.current,
        opacity: isHighlighter ? markerStyle.opacity : penOpacityRef.current,
        kind: isHighlighter ? 'highlighter' : 'pen',
      };
      activePath.current = stroke;
      pathsRef.current = [...pathsRef.current, stroke];
      setPaths(pathsRef.current);
      setRedo([]);
    },
    onPanResponderMove: e => {
      const touches = e.nativeEvent.touches || [];
      if (touches.length >= 2) {
        activePath.current = null;
        selectionGesture.current = null;
        lassoRef.current = []; setLasso([]);
        const [a, b] = touches;
        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        if (!pinchStart.current && distance > 0) {
          pinchStart.current = { distance, zoom: zoomRef.current, centerX: (a.pageX + b.pageX) / 2, centerY: (a.pageY + b.pageY) / 2, pan: { ...panRef.current } };
          panStart.current = null;
          return;
        }
        if (pinchStart.current?.distance) {
          const nextZoom = Math.min(3, Math.max(0.5, pinchStart.current.zoom * distance / pinchStart.current.distance));
          zoomRef.current = nextZoom;
          setZoom(nextZoom);
          const centerX = (a.pageX + b.pageX) / 2;
          const centerY = (a.pageY + b.pageY) / 2;
          const nextPan = { x: pinchStart.current.pan.x + centerX - pinchStart.current.centerX, y: pinchStart.current.pan.y + centerY - pinchStart.current.centerY };
          panRef.current = nextPan;
          setPan(nextPan);
        }
        return;
      }
      pinchStart.current = null;
      if (toolRef.current === 'select' && selectionGesture.current?.type === 'lasso') {
        const point=screenToDocument({x:e.nativeEvent.locationX,y:e.nativeEvent.locationY},{zoom: zoomRef.current, pan: panRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2}});
        const next=[...lassoRef.current,point]; lassoRef.current=next; setLasso(next); return;
      }
      if (toolRef.current === 'select' && selectionGesture.current?.type === 'resize') {
        const point=screenToDocument({x:e.nativeEvent.locationX,y:e.nativeEvent.locationY},{zoom: zoomRef.current, pan: panRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2}});
        const factor=Math.max(0.25,Math.min(4,Math.hypot(point.x-selectionGesture.current.center.x,point.y-selectionGesture.current.center.y)/selectionGesture.current.startDistance));
        selectionGesture.current.factor=factor;
        const resized=scaleSelected(selectionGesture.current.original,selectedRef.current,factor);
        pathsRef.current=resized;setPaths(resized);return;
      }
      if (toolRef.current === 'select' && selectionGesture.current?.type === 'move') {
        const point=screenToDocument({x:e.nativeEvent.locationX,y:e.nativeEvent.locationY},{zoom: zoomRef.current, pan: panRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2}});
        const dx=point.x-selectionGesture.current.start.x, dy=point.y-selectionGesture.current.start.y;
        const original=selectionGesture.current.original;
        const moved=original.map(stroke=>selectedRef.current.includes(stroke.id)?{...stroke,points:stroke.points.map(p=>({x:p.x+dx,y:p.y+dy}))}:stroke);
        pathsRef.current=moved; setPaths(moved); return;
      }
      if (toolRef.current === 'move') {
        if (panStart.current) {
          const next = { x: panStart.current.pan.x + e.nativeEvent.pageX - panStart.current.x, y: panStart.current.pan.y + e.nativeEvent.pageY - panStart.current.y };
          panRef.current = next;
          setPan(next);
        }
        return;
      }
      const p = screenToDocument({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }, { zoom: zoomRef.current, pan: panRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2} });
      if (toolRef.current === 'eraser') {
        const previous = pathsRef.current;
        const next = eraserModeRef.current === 'whole'
          ? eraseWholeStrokesAtPoint(previous, p, eraserSizeRef.current)
          : eraseAtPoint(previous, p, eraserSizeRef.current);
        const changed = next.length !== previous.length || next.some((path, index) => path !== previous[index]);
        if (changed) {
          pathsRef.current = next;
          setPaths(next);
        }
        return;
      }
      if (!activePath.current) return;
      const next = { ...activePath.current, points: [...activePath.current.points, p] };
      activePath.current = next;
      pathsRef.current = [...pathsRef.current.slice(0, -1), next];
      setPaths(pathsRef.current);
    },
    onPanResponderRelease: e => {
      if (toolRef.current === 'select' && selectionGesture.current?.type === 'lasso') {
        const polygon=lassoRef.current;
        const ids=polygon.length>=3 ? pathsRef.current.filter(stroke=>pathIntersectsPolygon(stroke, polygon)).map(stroke=>stroke.id) : [];
        selectedRef.current=ids; setSelectedIds(ids); lassoRef.current=[]; setLasso([]);
      } else if (toolRef.current === 'select' && selectionGesture.current?.type === 'resize') {
        const resized=scaleSelected(selectionGesture.current.original,selectedRef.current,selectionGesture.current.factor||1);
        pathsRef.current=resized;setPaths(resized);setRedo([]);
      } else if (toolRef.current === 'select' && selectionGesture.current?.type === 'move') {
        const point=screenToDocument({x:e.nativeEvent.locationX,y:e.nativeEvent.locationY},{zoom: zoomRef.current, pan: panRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2}});
        const dx=point.x-selectionGesture.current.start.x, dy=point.y-selectionGesture.current.start.y;
        const original=selectionGesture.current.original;
        const moved=original.map(stroke=>selectedRef.current.includes(stroke.id)?{...stroke,points:stroke.points.map(p=>({x:p.x+dx,y:p.y+dy}))}:stroke);
        pathsRef.current=moved; setPaths(moved); setRedo([]);
      }
      recordPathSnapshot();
      selectionGesture.current=null;
      activePath.current = null;
      panStart.current = null;
      if ((e.nativeEvent.touches?.length || 0) < 2) pinchStart.current = null;
    },
    onPanResponderTerminate: () => { activePath.current = null; pinchStart.current = null; panStart.current = null; selectionGesture.current=null; lassoRef.current=[]; setLasso([]); },
  }), []);

  const changePage = (next) => {
    if (next < 0 || next >= pages.length || next === index) return;
    const currentPaths = pathsRef.current;
    setPages(old => old.map((page, i) => i === index ? { ...page, paths: currentPaths } : page));
    const nextPaths = pages[next].paths || [];
    setIndex(next);
    pathsRef.current = nextPaths;
    setPaths(nextPaths);
    setRedo([]);
    setSelectedIds([]);
    selectedRef.current = [];
    setLasso([]);
    lassoRef.current = [];
    selectionGesture.current = null;
    const nextHistory = createHistory(nextPaths);
    pathHistoryRef.current = nextHistory;
    setPathHistory(nextHistory);
  };
  const saveAndExit = async () => {
    const updatedPages = pages.map((page, i) => i === index ? { ...page, paths: pathsRef.current } : page);
    const currentRemaining = paused ? remainingRef.current : Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
    const elapsed = Math.max(0, exam.duration - currentRemaining);
    const updatedExam = {
      ...exam,
      pages: updatedPages,
      currentPage: index,
      zoom,
      pan,
      remaining: currentRemaining,
      elapsed,
      endAt: endAtRef.current,
      status: finalized ? 'Finalizada' : (paused ? 'Pausada' : (currentRemaining === 0 ? 'Tempo encerrado' : 'Em andamento')),
    };
    // Aguarda a fila de autosave antes de sair do editor.
    persistLatestSnapshot();
    await persistenceQueueRef.current;
    await onSave(updatedExam);
  };
  const togglePause = () => {
    if (finalized || finished) return;
    if (paused) {
      endAtRef.current = Date.now() + remaining * 1000;
      setPaused(false);
      persistExamState({ endAt: endAtRef.current, status: 'Em andamento' });
    } else {
      const currentRemaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setRemaining(currentRemaining);
      setPaused(true);
      persistExamState({ remaining: currentRemaining, status: 'Pausada' });
    }
  };
  const finalizeExam = () => Alert.alert('Finalizar prova?', 'Depois de finalizar, as anotações ficarão somente para consulta.', [
    { text: 'Continuar editando', style: 'cancel' },
    { text: 'Finalizar', style: 'destructive', onPress: () => {
      setFinalized(true);
      const updatedPages = pages.map((page, i) => i === index ? { ...page, paths: pathsRef.current } : page);
      const updatedExam = { ...exam, pages: updatedPages, currentPage: index, zoom, pan, remaining: remainingRef.current, elapsed: Math.max(0, exam.duration - remainingRef.current), endAt: endAtRef.current, status: 'Finalizada' };
      persistExamState({ status: 'Finalizada' });
      persistenceQueueRef.current.then(() => onSave(updatedExam)).catch(error => {
        console.error('Erro ao finalizar prova:', error);
        Alert.alert('Não foi possível finalizar', 'Suas anotações continuam salvas. Tente salvar e sair novamente.');
      });
    } },
  ]);
  const current = pages[index];

  return <SafeAreaView style={s.editorSafe}>
    <StatusBar barStyle="dark-content" backgroundColor={PAPER} />
    <View style={[s.editorHead, { backgroundColor: design.colors.ink }]}><Pressable onPress={saveAndExit} style={s.back}><Text style={s.backText}>‹</Text></Pressable><View style={{ flex: 1 }}><Text style={s.editorTitle}>{exam.title}</Text><Text style={s.examDescription}>Página {index + 1} de {pages.length} · {paused ? 'Pausada' : finalized ? 'Finalizada' : 'Em andamento'} · {saveState === 'saving' ? 'Salvando…' : saveState === 'error' ? 'Falha ao salvar' : 'Salvo'}</Text></View><View style={s.timerPill}><Text style={s.timerText}>{formatTime(remaining)}</Text></View></View>
    {finished && <View style={s.finishedBanner}><Text style={s.finishedText}>Tempo encerrado. Você ainda pode consultar e salvar suas anotações.</Text></View>}
    {paused && <View style={s.finishedBanner}><Text style={s.finishedText}>Prova pausada. O cronômetro será retomado quando você tocar em Continuar.</Text></View>}
    {finalized && <View style={s.finishedBanner}><Text style={s.finishedText}>Prova finalizada. As anotações estão disponíveis apenas para consulta.</Text></View>}
    <ContextToolbar><IconButton label="↶" accessibilityLabel="Desfazer" onPress={() => { const nextHistory = undoHistory(pathHistoryRef.current); pathHistoryRef.current = nextHistory; setPathHistory(nextHistory); pathsRef.current = nextHistory.present; setPaths(nextHistory.present); }} disabled={finalized || pathHistory.past.length <= 1} /><IconButton label="↷" accessibilityLabel="Refazer" onPress={() => { const nextHistory = redoHistory(pathHistoryRef.current); pathHistoryRef.current = nextHistory; setPathHistory(nextHistory); pathsRef.current = nextHistory.present; setPaths(nextHistory.present); }} disabled={finalized || !pathHistory.future.length} /><View style={{ flex: 1 }} /><IconButton label={paused ? '▶' : 'Ⅱ'} accessibilityLabel={paused ? 'Continuar prova' : 'Pausar prova'} onPress={togglePause} disabled={finalized || finished} /></ContextToolbar>
    <View style={s.examCanvas} onLayout={event => setCanvasSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}><View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: zoom }] }]}><Image source={{ uri: current?.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /><Svg width="100%" height="100%">{paths.map(stroke => <Path key={stroke.id} d={svgPath(stroke.points)} stroke={stroke.color} strokeOpacity={stroke.opacity ?? 1} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}{lasso.length>1 && <Path d={svgPath(lasso)} stroke={GREEN} strokeWidth={2} strokeDasharray="6 4" fill="none" />}{selectedIds.length>0 && (()=>{const b=boundsFor(paths.filter(stroke=>selectedIds.includes(stroke.id)));return b?<><Rect x={b.minX-7} y={b.minY-7} width={Math.max(20,b.maxX-b.minX+14)} height={Math.max(20,b.maxY-b.minY+14)} stroke={GREEN} strokeWidth={1.5} strokeDasharray="5 4" fill="none"/><Rect x={b.maxX+1} y={b.maxY+1} width={12} height={12} rx={3} fill={GREEN}/></>:null;})()}</Svg></View><View style={StyleSheet.absoluteFill} {...responder.panHandlers} /></View>
    <View style={s.pageControls}><Pressable disabled={index === 0} onPress={() => changePage(index - 1)} style={s.pageControlButton}><Text style={s.pageControlText}>‹</Text></Pressable><View style={s.pageProgress}><Text style={s.pageText}>Página {index + 1} de {pages.length}</Text><View style={s.pageProgressTrack}><View style={[s.pageProgressFill, { width: `${((index + 1) / Math.max(1, pages.length)) * 100}%` }]} /></View></View><Pressable disabled={index === pages.length - 1} onPress={() => changePage(index + 1)} style={s.pageControlButton}><Text style={s.pageControlText}>›</Text></Pressable></View>
    <ScrollView pointerEvents={finalized ? 'none' : 'auto'} style={[s.drawPanel, { maxHeight: toolsExpanded ? 300 : 116 }, finalized && { opacity: 0.55 }]} contentContainerStyle={{ paddingBottom: toolsExpanded ? 8 : 4 }} showsVerticalScrollIndicator={false}>
      <Text style={s.selectionHint}>{tool==='select'?(selectedIds.length ? `${selectedIds.length} selecionado(s) · arraste para mover` : 'Contorne a escrita com o dedo para selecionar.'):'Escolha uma ferramenta para anotar a prova.'}</Text>{selectedIds.length>0 && <View style={s.selectionActions}><Pressable onPress={()=>applyPathChange(scaleSelected(pathsRef.current,selectedIds,1.15))} style={s.selectionAction}><Text style={s.toolbarText}>＋ Tamanho</Text></Pressable><Pressable onPress={()=>applyPathChange(scaleSelected(pathsRef.current,selectedIds,0.87))} style={s.selectionAction}><Text style={s.toolbarText}>− Tamanho</Text></Pressable><Pressable onPress={()=>applyPathChange(rotateSelected(pathsRef.current,selectedIds,Math.PI/12))} style={s.selectionAction}><Text style={s.toolbarText}>↻ Girar</Text></Pressable><Pressable onPress={()=>{const picked=pathsRef.current.filter(stroke=>selectedIds.includes(stroke.id));setSelectedClipboard(picked);applyPathChange(pathsRef.current.filter(stroke=>!selectedIds.includes(stroke.id)));setSelectedIds([]);}} style={s.selectionAction}><Text style={s.toolbarText}>Cortar</Text></Pressable><Pressable onPress={()=>{if(!selectedClipboard.length)return;const pasted=selectedClipboard.map(stroke=>({...stroke,id:String(Date.now())+Math.random(),points:stroke.points.map(p=>({x:p.x+24,y:p.y+24}))}));applyPathChange([...pathsRef.current,...pasted]);setSelectedIds(pasted.map(stroke=>stroke.id));}} style={s.selectionAction}><Text style={s.toolbarText}>Colar</Text></Pressable><Pressable onPress={()=>{applyPathChange(pathsRef.current.filter(stroke=>!selectedIds.includes(stroke.id)));setSelectedIds([]);}} style={s.selectionAction}><Text style={[s.toolbarText,{color:'#B44D45'}]}>Excluir</Text></Pressable><Pressable onPress={()=>setSelectedIds([])} style={s.selectionAction}><Text style={s.toolbarText}>Nova seleção</Text></Pressable></View>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quickToolScroll} contentContainerStyle={s.compactToolRow}>{[{id:'pen',glyph:'✎',label:'Caneta'},{id:'highlighter',glyph:'▰',label:'Marca-texto'},{id:'eraser',glyph:'⌫',label:'Borracha'},{id:'select',glyph:'⌁',label:'Laço'},{id:'move',glyph:'✥',label:'Mover'}].map(item=><Pressable key={item.id} onPress={()=>{setTool(item.id);if(item.id!=='select'){setSelectedIds([]);selectedRef.current=[];setLasso([]);lassoRef.current=[];}}} style={[s.quickToolButton,tool===item.id&&s.quickToolButtonActive]}><Text style={s.quickToolGlyph}>{item.glyph}</Text><Text style={[s.quickToolLabel,tool===item.id&&s.quickToolLabelActive]}>{item.label}</Text></Pressable>)}<Pressable onPress={()=>setToolsExpanded(value=>!value)} style={[s.moreToolsButton,toolsExpanded&&s.moreToolsButtonActive]}><Text style={s.moreToolsGlyph}>{toolsExpanded?'⌃':'•••'}</Text><Text style={s.moreToolsText}>{toolsExpanded?'Fechar':'Mais'}</Text></Pressable></ScrollView>
      {toolsExpanded && <View style={s.expandedTools}><View style={s.drawTools}><Pressable onPress={() => setTool('pen')} style={[s.tool, tool === 'pen' && s.toolActive]}><Text style={s.toolText}>✎ Caneta</Text></Pressable><Pressable onPress={() => setTool('highlighter')} style={[s.tool, tool === 'highlighter' && s.toolActive]}><Text style={s.toolText}>▰ Marca-texto</Text></Pressable><Pressable onPress={() => setTool('eraser')} style={[s.tool, tool === 'eraser' && s.toolActive]}><Text style={s.toolText}>⌫ Borracha</Text></Pressable><Pressable onPress={() => setTool('move')} style={[s.tool, tool === 'move' && s.toolActive]}><Text style={s.toolText}>✥ Mover folha</Text></Pressable><Pressable onPress={() => Alert.alert('Limpar anotações desta página?', 'Esta ação pode ser desfeita pelo botão Desfazer.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Limpar página', style: 'destructive', onPress: () => {
          applyPathChange([]);
          setSelectedIds([]);
          selectedRef.current = [];
        } },
      ])} style={s.tool}><Text style={s.toolText}>⌫ Limpar página</Text></Pressable></View>
      {tool === 'pen' && <><View style={s.strokePicker}><View style={s.strokePickerHeader}><Text style={s.paletteTitle}>ESPESSURA DA CANETA</Text><Text style={s.strokeValue}>{penWidth}px</Text></View><View style={s.strokeOptions}>{[{ width: 2, label: 'Fina' }, { width: 4, label: 'Média' }, { width: 7, label: 'Grossa' }, { width: 11, label: 'Extra' }].map(option => <Pressable key={option.width} accessibilityRole="button" accessibilityLabel={`Espessura ${option.label}`} onPress={() => setPenWidth(option.width)} style={[s.strokeOption, penWidth === option.width && s.strokeOptionActive]}><View style={s.strokePreview}><View style={[s.strokeLine, { height: option.width, borderRadius: option.width / 2 }]} /></View><Text style={[s.strokeOptionLabel, penWidth === option.width && s.strokeOptionLabelActive]}>{option.label}</Text></Pressable>)}</View></View><View style={s.strokePicker}><Text style={s.paletteTitle}>OPACIDADE</Text><View style={s.strokeOptions}>{[{value:0.45,label:'45%'},{value:0.7,label:'70%'},{value:0.85,label:'85%'},{value:1,label:'100%'}].map(option=><Pressable key={option.value} onPress={()=>setPenOpacity(option.value)} style={[s.strokeOption,s.opacityOption,penOpacity===option.value&&s.strokeOptionActive]}><View style={[s.opacityPreview,{backgroundColor:color,opacity:option.value}]}/><Text style={[s.strokeOptionLabel,penOpacity===option.value&&s.strokeOptionLabelActive]}>{option.label}</Text></Pressable>)}</View></View></>}
      {tool === 'eraser' && <View style={s.strokePicker}><View style={s.strokePickerHeader}><Text style={s.paletteTitle}>TAMANHO DA BORRACHA</Text><Text style={s.strokeValue}>{eraserSize}px</Text></View><View style={s.strokeOptions}>{[{value:12,label:'Pequena'},{value:24,label:'Média'},{value:40,label:'Grande'},{value:60,label:'Extra'}].map(option=><Pressable key={option.value} onPress={()=>setEraserSize(option.value)} style={[s.strokeOption,eraserSize===option.value&&s.strokeOptionActive]}><View style={s.strokePreview}><View style={[s.eraserPreview,{width:Math.min(42,option.value),height:Math.min(18,option.value/2)}]}/></View><Text style={[s.strokeOptionLabel,eraserSize===option.value&&s.strokeOptionLabelActive]}>{option.label}</Text></Pressable>)}</View><View style={s.markerTypes}><Text style={s.paletteTitle}>MODO DE APAGAR</Text><Pressable onPress={()=>setEraserMode('partial')} style={[s.markerType,eraserMode==='partial'&&s.markerTypeActive]}><Text style={[s.markerTypeText,eraserMode==='partial'&&s.markerTypeTextActive]}>Parte do traço</Text></Pressable><Pressable onPress={()=>setEraserMode('whole')} style={[s.markerType,eraserMode==='whole'&&s.markerTypeActive]}><Text style={[s.markerTypeText,eraserMode==='whole'&&s.markerTypeTextActive]}>Traço inteiro</Text></Pressable></View><Text style={s.toolHelp}>{eraserMode==='whole'?'Remove o traço completo ao tocar nele.':'Apaga somente os segmentos que passam pela área tocada.'}</Text></View>}
      {tool === 'highlighter' && <><View style={s.strokePicker}><View style={s.strokePickerHeader}><Text style={s.paletteTitle}>ESPESSURA DO MARCA-TEXTO</Text><Text style={s.strokeValue}>{markerWidth}px</Text></View><View style={s.strokeOptions}>{[{ width: 10, label: 'Fina' }, { width: 18, label: 'Média' }, { width: 28, label: 'Larga' }].map(option => <Pressable key={option.width} accessibilityRole="button" accessibilityLabel={`Espessura do marca-texto ${option.label}`} onPress={() => setMarkerWidth(option.width)} style={[s.strokeOption, markerWidth === option.width && s.strokeOptionActive]}><View style={s.strokePreview}><View style={[s.markerStrokeLine, { height: Math.min(18, Math.max(6, option.width / 1.5)) }]} /></View><Text style={[s.strokeOptionLabel, markerWidth === option.width && s.strokeOptionLabelActive]}>{option.label}</Text></Pressable>)}</View></View><View style={s.markerTypes}><Text style={s.paletteTitle}>ESTILO</Text>{[{id:'classic',label:'Clássico'},{id:'pastel',label:'Pastel'},{id:'bold',label:'Forte'},{id:'underline',label:'Sublinhado'}].map(item=><Pressable key={item.id} onPress={()=>setMarkerType(item.id)} style={[s.markerType,markerType===item.id&&s.markerTypeActive]}><Text style={[s.markerTypeText,markerType===item.id&&s.markerTypeTextActive]}>{item.label}</Text></Pressable>)}</View></>}
      </View>}
      {toolsExpanded && <><View style={s.paletteSection}><Text style={s.paletteTitle}>CORES</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.palette}>{COLORS.map(c => <Pressable key={c} onPress={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }} style={[s.swatch, { backgroundColor: c, borderColor: c === '#FFFFFF' ? '#AEB5AE' : c }, color === c && s.swatchSelected]} />)}</ScrollView></View><View style={s.paletteRow}><View style={s.zoomControls}><Pressable style={s.zoomButton} onPress={() => { const next = Math.max(0.5, Number((zoom - 0.25).toFixed(2))); zoomRef.current = next; setZoom(next); }}><Text style={s.zoomText}>−</Text></Pressable><Text style={s.zoomValue}>{Math.round(zoom * 100)}%</Text><Pressable style={s.zoomButton} onPress={() => { const next = Math.min(3, Number((zoom + 0.25).toFixed(2))); zoomRef.current = next; setZoom(next); }}><Text style={s.zoomText}>+</Text></Pressable><Pressable style={s.zoomReset} onPress={() => { zoomRef.current = 1; setZoom(1); panRef.current = { x: 0, y: 0 }; setPan({ x: 0, y: 0 }); }}><Text style={s.zoomResetText}>Ajustar</Text></Pressable></View></View><Button title="Salvar e sair" onPress={saveAndExit} /><Button title="Finalizar prova" secondary onPress={finalizeExam} disabled={finalized} /></>}</ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAPER }, header: { flexDirection: 'row', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderColor: LINE },
  back: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  backText: { color: INK, fontSize: 30, marginTop: -4 }, brand: { color: INK, fontSize: 21, fontWeight: '700' }, sub: { color: '#89938A', fontSize: 11, marginTop: 3 },
  content: { padding: 18, paddingBottom: 36 }, section: { color: INK, fontSize: 20, fontWeight: '700', marginBottom: 12 },
  examCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 17, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: LINE },
  examBadge: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  examBadgeText: { color: GREEN, fontWeight: '800', fontSize: 11 }, examTitle: { color: INK, fontSize: 15, fontWeight: '700' },
  examDescription: { color: '#69766D', fontSize: 11, marginTop: 4, lineHeight: 16 }, examDuration: { color: GREEN, fontSize: 11, fontWeight: '700', marginTop: 7 },
  chevron: { color: '#9AA298', fontSize: 28, paddingLeft: 8 }, empty: { backgroundColor: '#FFF', padding: 20, borderRadius: 16, alignItems: 'center' },
  emptyTitle: { color: INK, fontWeight: '700', fontSize: 14 }, emptyText: { color: '#89938A', textAlign: 'center', fontSize: 11, lineHeight: 17, marginTop: 6 },
  savedCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderWidth: 1, borderColor: LINE, borderRadius: 15, padding: 14, marginBottom: 9 },
  savedHeader: { flexDirection: 'row', alignItems: 'center' },
  savedSummary: { color: '#89938A', fontSize: 11, marginBottom: 10 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderWidth: 1, borderColor: LINE, borderRadius: 13, paddingHorizontal: 12, marginBottom: 9 },
  searchGlyph: { color: GREEN, fontSize: 22, marginRight: 8 },
  searchInput: { flex: 1, minHeight: 44, color: INK, fontSize: 12, paddingVertical: 8 },
  clearSearch: { color: GREEN, fontSize: 10, fontWeight: '700', padding: 7 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 11 },
  filterChip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 20, backgroundColor: '#ECEFEA', borderWidth: 1, borderColor: '#E1E7E0' },
  filterChipActive: { backgroundColor: '#DDEBE0', borderColor: '#A9C4AE' },
  filterChipText: { color: '#667269', fontSize: 10, fontWeight: '700' },
  filterChipTextActive: { color: GREEN },
  savedCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  statusPill: { overflow: 'hidden', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, fontWeight: '800' },
  statusActive: { color: '#315C49', backgroundColor: '#E8F0E9' },
  statusPaused: { color: '#8A5A14', backgroundColor: '#FFF2D9' },
  statusFinished: { color: '#5F6368', backgroundColor: '#EEF0EF' },
  savedProgressTrack: { height: 4, backgroundColor: '#EDF0EB', borderRadius: 4, overflow: 'hidden', marginTop: 10 },
  savedProgressFill: { height: '100%', backgroundColor: GREEN, borderRadius: 4 },
  savedMeta: { color: '#89938A', fontSize: 9, marginTop: 7 },
  delete: { padding: 9, backgroundColor: '#FBEFED', borderRadius: 9 }, deleteText: { color: '#C96F68', fontSize: 10, fontWeight: '700' },
  setup: { flex: 1, padding: 24, justifyContent: 'center' }, kicker: { color: GREEN, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  setupTitle: { color: INK, fontSize: 31, fontWeight: '700', marginTop: 8 }, setupDescription: { color: '#89938A', fontSize: 13, marginTop: 6 },
  timerCard: { backgroundColor: INK, borderRadius: 22, padding: 24, alignItems: 'center', marginVertical: 24 },
  timerLabel: { color: '#C1CEC3', fontSize: 10, fontWeight: '700', letterSpacing: 1.4 }, timerPreview: { color: '#FFF', fontSize: 38, fontWeight: '700', marginTop: 12 },
  timerFoot: { color: '#C1CEC3', fontSize: 11, marginTop: 6 }, setupHint: { color: '#69766D', fontSize: 12, lineHeight: 19, marginBottom: 20 },
  button: { backgroundColor: INK, padding: 15, borderRadius: 13, alignItems: 'center', marginTop: 10 }, buttonSecondary: { backgroundColor: '#E8F0E9' },
  buttonText: { color: '#FFF', fontSize: 12, fontWeight: '700' }, buttonTextSecondary: { color: GREEN },
  converting: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }, convertingTitle: { color: INK, fontSize: 20, fontWeight: '700', marginTop: 18 },
  convertingText: { color: '#89938A', fontSize: 12, marginTop: 8 }, progressTrack: { height: 7, width: '100%', backgroundColor: '#E1E7DF', borderRadius: 5, marginTop: 22, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: GREEN }, smallNote: { color: '#9AA298', fontSize: 10, marginTop: 16 },
  editorSafe: { flex: 1, backgroundColor: '#F1F2EF' }, editorHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 9, backgroundColor: '#203B32', borderBottomWidth: 1, borderColor: '#203B32' },
  editorTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' }, timerPill: { backgroundColor: '#315C49', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: '#6E8A79' },
  timerText: { color: '#FFF', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }, finishedBanner: { padding: 9, backgroundColor: '#FBEFED' },
  finishedText: { color: '#A64F48', textAlign: 'center', fontSize: 10, fontWeight: '700' }, examToolbar: { flexDirection: 'row', justifyContent: 'space-around', padding: 10, backgroundColor: '#FFF' },
  moreToolsButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11, backgroundColor: '#F1F3EE' },
  moreToolsButtonActive: { backgroundColor: '#E8F0E9' },
  moreToolsGlyph: { color: GREEN, fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  moreToolsText: { color: GREEN, fontSize: 10, fontWeight: '700', marginLeft: 6 },
  quickSelectRow: { paddingHorizontal: 12, paddingBottom: 8, backgroundColor: '#FFF' },
  lassoMainButton: { flexDirection:'row', alignItems:'center', backgroundColor:'#E8F1E8', borderWidth:1.5, borderColor:'#9AB99D', borderRadius:13, paddingHorizontal:13, paddingVertical:11, marginBottom:9 },
  lassoMainButtonActive: { backgroundColor:'#CDE5D0', borderColor:GREEN, borderWidth:2 },
  lassoMainGlyph: { fontSize:27, color:GREEN, fontWeight:'800', marginRight:11 },
  lassoMainTitle: { color:INK, fontSize:12, fontWeight:'900' },
  lassoMainSubtitle: { color:'#58705E', fontSize:9, marginTop:3 },
  lassoMainChevron: { color:GREEN, fontSize:25, marginLeft:7 },
  quickSelectButton: { backgroundColor:'#E8F1E8', borderRadius:9, paddingHorizontal:11, paddingVertical:7, borderWidth:1, borderColor:'#C9DCCB' },
  quickSelectButtonActive: { backgroundColor:'#D6E9D8', borderColor:'#5A8B62' },
  quickSelectText: { color:'#426B49', fontSize:11, fontWeight:'700' },
  quickSelectTextActive: { color:'#245B2D' },
  toolbarText: { color: GREEN, fontSize: 11, fontWeight: '700' }, examCanvas: { flex: 1, marginHorizontal: 9, marginTop: 8, marginBottom: 6, backgroundColor: '#FFF', borderRadius: 5, overflow: 'hidden', elevation: 2, shadowColor: '#202522', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  pageControls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E4E7E2' },
  pageControlButton: { width: 40, height: 36, borderRadius: 11, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center' },
  pageControlText: { color: GREEN, fontSize: 24, lineHeight: 26, fontWeight: '700' },
  pageProgress: { flex: 1, alignItems: 'center', marginHorizontal: 12 },
  pageText: { color: '#89938A', fontSize: 10, fontWeight: '700' },
  pageProgressTrack: { width: '100%', maxWidth: 150, height: 3, borderRadius: 4, backgroundColor: '#E4EAE4', marginTop: 6, overflow: 'hidden' },
  pageProgressFill: { height: '100%', borderRadius: 4, backgroundColor: GREEN },
  drawPanel: { paddingHorizontal: 12, paddingTop: 9, paddingBottom: 10, backgroundColor: '#FFF', borderTopWidth: 1, borderColor: '#E4E7E2', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  selectionHint: { color:'#77847A', fontSize:10, marginBottom:7 },
  selectionActions: { flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:9 },
  selectionAction: { paddingHorizontal:10, paddingVertical:7, borderRadius:10, backgroundColor:'#E8F0E9', borderWidth:1, borderColor:'#D4E2D6' },
  quickToolScroll: { flexGrow: 0 },
  compactToolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5 },
  quickToolButton: { minWidth: 66, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 7, borderRadius: 11, backgroundColor: '#F4F5F1' },
  quickToolButtonActive: { backgroundColor: '#E0ECE1', borderWidth: 1, borderColor: '#A9C4AE' },
  quickToolGlyph: { color: '#52675A', fontSize: 17, lineHeight: 20 },
  quickToolLabel: { color: '#667269', fontSize: 9, fontWeight: '700', marginTop: 2 },
  quickToolLabelActive: { color: GREEN },
  opacityOption: { minHeight: 50 },
  opacityPreview: { width: 28, height: 8, borderRadius: 4 },
  eraserPreview: { backgroundColor: '#D7DAD4', borderRadius: 8, borderWidth: 1, borderColor: '#9CA69B', alignSelf: 'center' },
  toolHelp: { color: '#78847B', fontSize: 10, marginTop: 7 },
  compactTool: { flexDirection: 'row', alignItems: 'center', minWidth: 92, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11 },
  compactToolActive: { backgroundColor: '#E8F0E9' },
  compactToolGlyph: { color: GREEN, fontSize: 19, marginRight: 7 },
  compactToolText: { color: GREEN, fontSize: 10, fontWeight: '700' },
  expandedTools: { borderTopWidth: 1, borderTopColor: '#F0F1EC', paddingTop: 7 },
  drawTools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  strokePicker: { marginBottom: 10, padding: 10, borderRadius: 13, backgroundColor: '#F7F9F5', borderWidth: 1, borderColor: '#E1E9E1' },
  strokePickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  strokeValue: { color: GREEN, fontSize: 10, fontWeight: '800' },
  strokeOptions: { flexDirection: 'row', gap: 7 },
  strokeOption: { flex: 1, minHeight: 55, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8E1', paddingHorizontal: 4 },
  strokeOptionActive: { backgroundColor: '#DDEBE0', borderColor: GREEN, borderWidth: 1.5 },
  strokePreview: { width: '100%', height: 20, justifyContent: 'center' },
  strokeLine: { width: '100%', backgroundColor: INK },
  markerStrokeLine: { width: '100%', borderRadius: 10, backgroundColor: '#E4B83F', opacity: 0.55 },
  strokeOptionLabel: { color: '#718078', fontSize: 9, fontWeight: '700', marginTop: 5 },
  strokeOptionLabelActive: { color: GREEN },
  markerTypes: { flexDirection:'row', flexWrap:'wrap', alignItems:'center', gap:6, marginBottom:9 },
  markerType: { paddingHorizontal:10, paddingVertical:7, borderRadius:8, backgroundColor:'#F1F2EE', borderWidth:1, borderColor:'#E3E6DF' },
  markerTypeActive: { backgroundColor:'#DCEBDD', borderColor:GREEN },
  markerTypeText: { color:'#667269', fontSize:10, fontWeight:'600' },
  markerTypeTextActive: { color:GREEN, fontWeight:'800' },
  paletteSection: { marginBottom:8 },
  paletteTitle: { color:'#718078', fontSize:9, fontWeight:'800', letterSpacing:0.8, marginBottom:6 },
  paletteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  zoomControls: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  zoomButton: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: GREEN, fontSize: 20, fontWeight: '700', lineHeight: 23 },
  zoomValue: { color: INK, fontSize: 10, fontWeight: '700', minWidth: 36, textAlign: 'center' },
  zoomReset: { paddingHorizontal: 8, paddingVertical: 7, backgroundColor: '#F2F3EF', borderRadius: 8 },
  zoomResetText: { color: GREEN, fontSize: 10, fontWeight: '700' }, tool: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, backgroundColor: '#F2F3EF' },
  toolActive: { backgroundColor: '#E8F0E9' }, toolText: { color: GREEN, fontSize: 11, fontWeight: '700' }, palette: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  swatch: { width: 24, height: 24, borderRadius: 12 }, swatchSelected: { borderWidth: 3, borderColor: '#A7BDAA' },
});
