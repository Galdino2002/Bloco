import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Image, PanResponder, Pressable, SafeAreaView, ScrollView,
  StatusBar, StyleSheet, Text, View, ActivityIndicator,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import Svg, { Path } from 'react-native-svg';

const STORAGE_KEY = '@bloco:exams:v1';
const DIR = FileSystem.documentDirectory + 'bloco-exams/';
const GREEN = '#315C49';
const INK = '#203B32';
const PAPER = '#F7F6F1';
const LINE = '#E7E8E1';
const COLORS = ['#203B32', '#D85D52', '#477BA8', '#D99A35', '#7659A6'];

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
function svgPath(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}
function Button({ title, onPress, secondary = false, disabled = false }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.buttonSecondary, disabled && { opacity: 0.4 }, pressed && { opacity: 0.75 }]}><Text style={[s.buttonText, secondary && s.buttonTextSecondary]}>{title}</Text></Pressable>;
}

export default function ExamMode({ onExit }) {
  const [saved, setSaved] = useState([]);
  const [selected, setSelected] = useState(null);
  const [active, setActive] = useState(null);
  const [stage, setStage] = useState('choose');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [webReady, setWebReady] = useState(false);
  const [pdfBase64, setPdfBase64] = useState(null);
  const webRef = useRef(null);
  const pagesRef = useRef([]);

  useEffect(() => { loadSaved(); }, []);
  const loadSaved = async () => {
    try { const raw = await AsyncStorage.getItem(STORAGE_KEY); setSaved(raw ? JSON.parse(raw) : []); }
    catch (e) { Alert.alert('Erro ao carregar provas', 'Não foi possível ler as provas salvas neste aparelho.'); }
  };
  const persist = async (items) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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
    const next = saved.some(x => x.id === exam.id) ? saved.map(x => x.id === exam.id ? updated : x) : [updated, ...saved];
    await persist(next);
    setActive(null); setStage('choose');
  };
  const resumeExam = (exam) => { setActive(exam); setStage('editor'); };
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
    <View style={s.header}><Pressable onPress={onExit} style={s.back}><Text style={s.backText}>‹</Text></Pressable><View style={{ flex: 1 }}><Text style={s.brand}>Ambiente de provas</Text><Text style={s.sub}>Escolha a prova e prepare seu tempo</Text></View></View>
    {stage === 'choose' && <ScrollView contentContainerStyle={s.content}>
      <Text style={s.section}>Escolha o exame</Text>
      {EXAMS.map(exam => <Pressable key={exam.id} onPress={() => { setSelected(exam); setStage('setup'); }} style={({ pressed }) => [s.examCard, pressed && { opacity: 0.75 }]}><View style={s.examBadge}><Text style={s.examBadgeText}>{exam.id.startsWith('ENEM') ? 'ENEM' : exam.id}</Text></View><View style={{ flex: 1 }}><Text style={s.examTitle}>{exam.name}</Text><Text style={s.examDescription}>{exam.description}</Text><Text style={s.examDuration}>Tempo: {exam.durationLabel}</Text></View><Text style={s.chevron}>›</Text></Pressable>)}
      <Text style={[s.section, { marginTop: 24 }]}>Provas salvas</Text>
      {!saved.length ? <View style={s.empty}><Text style={s.emptyTitle}>Nenhuma prova salva</Text><Text style={s.emptyText}>Depois de importar um PDF, sua prova ficará disponível aqui para continuar de onde parou.</Text></View> : saved.map(exam => <View key={exam.id} style={s.savedCard}><Pressable onPress={() => resumeExam(exam)} style={{ flex: 1 }}><Text style={s.examTitle}>{exam.title}</Text><Text style={s.examDescription}>{exam.pages?.length || 0} páginas · {formatTime(exam.remaining || 0)} restantes</Text><Text style={s.examDuration}>{exam.status || 'Salva'}</Text></Pressable><Pressable onPress={() => deleteExam(exam)} style={s.delete}><Text style={s.deleteText}>Excluir</Text></Pressable></View>)}
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
  const [index, setIndex] = useState(0);
  const [paths, setPaths] = useState(exam.pages?.[0]?.paths || []);
  const [redo, setRedo] = useState([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [remaining, setRemaining] = useState(exam.remaining ?? exam.duration);
  const [finished, setFinished] = useState(false);
  const activePath = useRef(null);
  const pathsRef = useRef(paths);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const zoomRef = useRef(1);
  const pinchStart = useRef(null);
  const panStart = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  pathsRef.current = paths; toolRef.current = tool; colorRef.current = color;

  const snapshotRef = useRef({ pages, index, paths, remaining });
  snapshotRef.current = { pages, index, paths, remaining };
  useEffect(() => {
    const id = setInterval(() => setRemaining(v => Math.max(0, v - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (remaining <= 0) setFinished(true); }, [remaining]);
  useEffect(() => {
    const id = setInterval(() => {
      const snapshot = snapshotRef.current;
      const current = snapshot.pages.map((page, i) => i === snapshot.index ? { ...page, paths: snapshot.paths } : page);
      const elapsed = Math.max(0, exam.duration - snapshot.remaining);
      AsyncStorage.getItem(STORAGE_KEY).then(raw => {
        const list = raw ? JSON.parse(raw) : [];
        const next = list.map(item => item.id === exam.id ? { ...item, pages: current, remaining: snapshot.remaining, elapsed, updatedAt: Date.now() } : item);
        return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, []);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: e => (e.nativeEvent.touches?.length || 0) >= 2 || true,
    onPanResponderGrant: e => {
      const touches = e.nativeEvent.touches || [];
      if (touches.length >= 2) {
        activePath.current = null;
        panStart.current = null;
        const [a, b] = touches;
        pinchStart.current = {
          distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
          zoom: zoomRef.current,
        };
        return;
      }
      if (toolRef.current === 'move') {
        activePath.current = null;
        panStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, pan: panRef.current };
        return;
      }
      if (toolRef.current === 'eraser') {
        const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        const next = pathsRef.current.filter(stroke => !stroke.points.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 24));
        pathsRef.current = next; setPaths(next); setRedo([]); return;
      }
      const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
      const isHighlighter = toolRef.current === 'highlighter';
      const stroke = {
        id: String(Date.now()) + Math.random(),
        points: [p],
        color: colorRef.current,
        width: isHighlighter ? 17 : 4,
        opacity: isHighlighter ? 0.28 : 1,
      };
      activePath.current = stroke; setPaths(old => [...old, stroke]); setRedo([]);
    },
    onPanResponderMove: e => {
      const touches = e.nativeEvent.touches || [];
      if (touches.length >= 2) {
        activePath.current = null;
        const [a, b] = touches;
        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        if (!pinchStart.current && distance > 0) {
          pinchStart.current = { distance, zoom: zoomRef.current };
          panStart.current = null;
          return;
        }
        if (pinchStart.current?.distance) {
          const nextZoom = Math.min(3, Math.max(1, pinchStart.current.zoom * distance / pinchStart.current.distance));
          zoomRef.current = nextZoom;
          setZoom(nextZoom);
        }
        return;
      }
      pinchStart.current = null;
      if (toolRef.current === 'move') {
        if (panStart.current) {
          const next = { x: panStart.current.pan.x + e.nativeEvent.pageX - panStart.current.x, y: panStart.current.pan.y + e.nativeEvent.pageY - panStart.current.y };
          panRef.current = next;
          setPan(next);
        }
        return;
      }
      if (toolRef.current === 'eraser' || !activePath.current) return;
      const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
      const next = { ...activePath.current, points: [...activePath.current.points, p] };
      activePath.current = next; setPaths(old => [...old.slice(0, -1), next]);
    },
    onPanResponderRelease: e => {
      activePath.current = null;
      panStart.current = null;
      if ((e.nativeEvent.touches?.length || 0) < 2) pinchStart.current = null;
    },
    onPanResponderTerminate: () => { activePath.current = null; pinchStart.current = null; panStart.current = null; },
  }), []);

  const changePage = (next) => {
    if (next < 0 || next >= pages.length) return;
    setPages(old => old.map((page, i) => i === index ? { ...page, paths } : page));
    setIndex(next); setPaths(pages[next].paths || []); setRedo([]);
  };
  const saveAndExit = () => {
    const updatedPages = pages.map((page, i) => i === index ? { ...page, paths } : page);
    const elapsed = Math.max(0, exam.duration - remaining);
    onSave({ ...exam, pages: updatedPages, remaining, elapsed, status: remaining === 0 ? 'Tempo encerrado' : 'Em andamento' });
  };
  const current = pages[index];

  return <SafeAreaView style={s.editorSafe}>
    <StatusBar barStyle="dark-content" backgroundColor={PAPER} />
    <View style={s.editorHead}><Pressable onPress={saveAndExit} style={s.back}><Text style={s.backText}>‹</Text></Pressable><View style={{ flex: 1 }}><Text style={s.editorTitle}>{exam.title}</Text><Text style={s.examDescription}>Página {index + 1} de {pages.length}</Text></View><View style={s.timerPill}><Text style={s.timerText}>{formatTime(remaining)}</Text></View></View>
    {finished && <View style={s.finishedBanner}><Text style={s.finishedText}>Tempo encerrado. Você ainda pode salvar suas anotações.</Text></View>}
    <View style={s.examToolbar}><Pressable onPress={() => { if (paths.length) { setRedo(old => [...old, paths[paths.length - 1]]); setPaths(old => old.slice(0, -1)); } }}><Text style={s.toolbarText}>↶ Desfazer</Text></Pressable><Pressable onPress={() => { if (redo.length) { setPaths(old => [...old, redo[redo.length - 1]]); setRedo(old => old.slice(0, -1)); } }}><Text style={s.toolbarText}>↷ Refazer</Text></Pressable><Pressable onPress={() => { setPaths([]); setRedo([]); }}><Text style={s.toolbarText}>Limpar</Text></Pressable></View>
    <View style={s.examCanvas}><View style={[StyleSheet.absoluteFill, { transform: [{ scale: zoom }, { translateX: pan.x / zoom }, { translateY: pan.y / zoom }] }]}><Image source={{ uri: current?.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /><View style={StyleSheet.absoluteFill} {...responder.panHandlers}><Svg width="100%" height="100%">{paths.map(stroke => <Path key={stroke.id} d={svgPath(stroke.points)} stroke={stroke.color} strokeOpacity={stroke.opacity ?? 1} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}</Svg></View></View></View>
    <View style={s.pageControls}><Pressable disabled={index === 0} onPress={() => changePage(index - 1)}><Text style={s.toolbarText}>‹ Anterior</Text></Pressable><Text style={s.pageText}>{index + 1} / {pages.length}</Text><Pressable disabled={index === pages.length - 1} onPress={() => changePage(index + 1)}><Text style={s.toolbarText}>Próxima ›</Text></Pressable></View>
    <View style={s.drawPanel}><View style={s.drawTools}><Pressable onPress={() => setTool('pen')} style={[s.tool, tool === 'pen' && s.toolActive]}><Text style={s.toolText}>Caneta</Text></Pressable><Pressable onPress={() => setTool('highlighter')} style={[s.tool, tool === 'highlighter' && s.toolActive]}><Text style={s.toolText}>Marca-texto</Text></Pressable><Pressable onPress={() => setTool('eraser')} style={[s.tool, tool === 'eraser' && s.toolActive]}><Text style={s.toolText}>Borracha</Text></Pressable><Pressable onPress={() => setTool('move')} style={[s.tool, tool === 'move' && s.toolActive]}><Text style={s.toolText}>Mover</Text></Pressable></View><View style={s.paletteRow}><View style={s.palette}>{COLORS.map(c => <Pressable key={c} onPress={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }} style={[s.swatch, { backgroundColor: c }, color === c && s.swatchSelected]} />)}</View><View style={s.zoomControls}><Pressable style={s.zoomButton} onPress={() => { const next = Math.max(1, Number((zoom - 0.25).toFixed(2))); zoomRef.current = next; setZoom(next); }}><Text style={s.zoomText}>−</Text></Pressable><Text style={s.zoomValue}>{Math.round(zoom * 100)}%</Text><Pressable style={s.zoomButton} onPress={() => { const next = Math.min(3, Number((zoom + 0.25).toFixed(2))); zoomRef.current = next; setZoom(next); }}><Text style={s.zoomText}>+</Text></Pressable><Pressable style={s.zoomReset} onPress={() => { zoomRef.current = 1; setZoom(1); panRef.current = { x: 0, y: 0 }; setPan({ x: 0, y: 0 }); }}><Text style={s.zoomResetText}>Ajustar</Text></Pressable></View></View><Button title="Salvar e sair" onPress={saveAndExit} /></View>
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
  examDescription: { color: '#89938A', fontSize: 10, marginTop: 4 }, examDuration: { color: GREEN, fontSize: 10, fontWeight: '700', marginTop: 6 },
  chevron: { color: '#9AA298', fontSize: 28, paddingLeft: 8 }, empty: { backgroundColor: '#FFF', padding: 20, borderRadius: 16, alignItems: 'center' },
  emptyTitle: { color: INK, fontWeight: '700', fontSize: 14 }, emptyText: { color: '#89938A', textAlign: 'center', fontSize: 11, lineHeight: 17, marginTop: 6 },
  savedCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderWidth: 1, borderColor: LINE, borderRadius: 15, padding: 14, marginBottom: 9 },
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
  editorSafe: { flex: 1, backgroundColor: PAPER }, editorHead: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: LINE },
  editorTitle: { color: INK, fontSize: 13, fontWeight: '700' }, timerPill: { backgroundColor: INK, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 11 },
  timerText: { color: '#FFF', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }, finishedBanner: { padding: 9, backgroundColor: '#FBEFED' },
  finishedText: { color: '#A64F48', textAlign: 'center', fontSize: 10, fontWeight: '700' }, examToolbar: { flexDirection: 'row', justifyContent: 'space-around', padding: 10, backgroundColor: '#FFF' },
  toolbarText: { color: GREEN, fontSize: 11, fontWeight: '700' }, examCanvas: { flex: 1, margin: 10, backgroundColor: '#FFF', borderRadius: 10, overflow: 'hidden' },
  pageControls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 9, backgroundColor: '#FFF' },
  pageText: { color: '#89938A', fontSize: 10, fontWeight: '700' }, drawPanel: { padding: 12, backgroundColor: '#FFF', borderTopWidth: 1, borderColor: LINE },
  drawTools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
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
