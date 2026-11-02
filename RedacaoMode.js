import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, PanResponder, Pressable, SafeAreaView, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { G, Line, Path } from 'react-native-svg';

const STORAGE_KEY = '@bloco:redacoes:v1';
const INK = '#203B32';
const GREEN = '#315C49';
const PAPER = '#F7F6F1';
const LINE = '#E7E8E1';
const COLORS = ['#203B32', '#D85D52', '#477BA8', '#7659A6'];

function makeDraft() {
  return {
    id: String(Date.now()),
    title: 'Minha redação',
    text: '',
    paths: [],
    mode: 'write',
    updatedAt: Date.now(),
  };
}

function pathData(points) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

function Action({ label, onPress, secondary = false }) {
  return (
    <Pressable onPress={onPress} style={[styles.action, secondary && styles.actionSecondary]}>
      <Text style={[styles.actionText, secondary && styles.actionTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

export default function RedacaoMode({ onExit }) {
  const [drafts, setDrafts] = useState([]);
  const [active, setActive] = useState(null);
  const [mode, setMode] = useState('write');
  const [color, setColor] = useState(COLORS[0]);
  const [paths, setPaths] = useState([]);
  const [redo, setRedo] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showLines, setShowLines] = useState(true);
  const [canvasTool, setCanvasTool] = useState('draw');
  const canvasToolRef = useRef('draw');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const moveStart = useRef(null);
  const pinchStart = useRef(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const activePath = useRef(null);
  const pathsRef = useRef(paths);
  const colorRef = useRef(color);
  pathsRef.current = paths;
  colorRef.current = color;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => setDrafts(raw ? JSON.parse(raw) : []))
      .catch(() => Alert.alert('Erro', 'Não foi possível carregar suas redações.'))
      .finally(() => setLoaded(true));
  }, []);

  const persist = async (items) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    setDrafts(items);
  };

  const openDraft = (draft) => {
    setActive(draft);
    setMode(draft.mode || 'write');
    setPaths(draft.paths || []);
    pathsRef.current = draft.paths || [];
    setRedo([]);
  };

  const createDraft = () => {
    const draft = makeDraft();
    setActive(draft);
    setMode('write');
    setPaths([]);
    pathsRef.current = [];
    setRedo([]);
  };

  const saveDraft = async () => {
    if (!active) return;
    const updated = { ...active, mode, paths, updatedAt: Date.now() };
    const next = drafts.some(item => item.id === updated.id)
      ? drafts.map(item => item.id === updated.id ? updated : item)
      : [updated, ...drafts];
    try {
      await persist(next);
      setActive(null);
      Alert.alert('Redação salva', 'Seu rascunho foi salvo neste aparelho.');
    } catch {
      Alert.alert('Erro ao salvar', 'Não foi possível salvar. Verifique o espaço disponível no aparelho.');
    }
  };

  const deleteDraft = (draft) => Alert.alert(
    'Excluir redação?',
    'Esta ação não poderá ser desfeita.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => {
        try { await persist(drafts.filter(item => item.id !== draft.id)); }
        catch { Alert.alert('Erro', 'Não foi possível excluir a redação.'); }
      } },
    ],
  );

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      const touches = event.nativeEvent.touches || [];
      if (touches.length >= 2) {
        const [a, b] = touches;
        pinchStart.current = { distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY), zoom: zoomRef.current, centerX: (a.pageX + b.pageX) / 2, centerY: (a.pageY + b.pageY) / 2, pan: panRef.current };
        return;
      }
      if (canvasToolRef.current === 'move') {
        moveStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, pan: panRef.current };
        return;
      }
      const point = { x: (event.nativeEvent.locationX - panRef.current.x) / zoomRef.current, y: (event.nativeEvent.locationY - panRef.current.y) / zoomRef.current };
      const stroke = {
        id: String(Date.now()) + Math.random(),
        points: [point],
        color: colorRef.current,
        width: 3.5,
      };
      activePath.current = stroke;
      setPaths(old => [...old, stroke]);
      setRedo([]);
    },
    onPanResponderMove: event => {
      const touches = event.nativeEvent.touches || [];
      if (touches.length >= 2) {
        activePath.current = null;
        const [a, b] = touches;
        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        if (!pinchStart.current && distance > 0) pinchStart.current = { distance, zoom: zoomRef.current, centerX: (a.pageX + b.pageX) / 2, centerY: (a.pageY + b.pageY) / 2, pan: panRef.current };
        if (pinchStart.current?.distance && distance > 0) {
          const nextZoom = Math.max(1, Math.min(3, pinchStart.current.zoom * distance / pinchStart.current.distance));
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
      if (canvasToolRef.current === 'move' && moveStart.current) {
        const nextPan = {
          x: moveStart.current.pan.x + event.nativeEvent.pageX - moveStart.current.x,
          y: moveStart.current.pan.y + event.nativeEvent.pageY - moveStart.current.y,
        };
        panRef.current = nextPan;
        setPan(nextPan);
        return;
      }
      if (!activePath.current) return;
      const point = { x: (event.nativeEvent.locationX - panRef.current.x) / zoomRef.current, y: (event.nativeEvent.locationY - panRef.current.y) / zoomRef.current };
      const updated = { ...activePath.current, points: [...activePath.current.points, point] };
      activePath.current = updated;
      setPaths(old => [...old.slice(0, -1), updated]);
    },
    onPanResponderRelease: () => { activePath.current = null; pinchStart.current = null; moveStart.current = null; },
    onPanResponderTerminate: () => { activePath.current = null; pinchStart.current = null; moveStart.current = null; },
  }), []);

  if (active) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={PAPER} />
        <View style={styles.header}>
          <Pressable onPress={saveDraft} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Ambiente de redação</Text>
            <Text style={styles.headerSub}>Seu espaço para desenvolver ideias</Text>
          </View>
          <Pressable onPress={saveDraft} style={styles.save}><Text style={styles.saveText}>Salvar</Text></Pressable>
        </View>
        <TextInput
          value={active.title}
          onChangeText={title => setActive(old => ({ ...old, title }))}
          placeholder="Título da redação"
          placeholderTextColor="#9AA298"
          style={styles.titleInput}
          maxLength={80}
        />
        <View style={styles.modeBar}>
          <Pressable onPress={() => setMode('write')} style={[styles.modeButton, mode === 'write' && styles.modeSelected]}>
            <Text style={[styles.modeText, mode === 'write' && styles.modeTextSelected]}>⌨ Escrever</Text>
          </Pressable>
          <Pressable onPress={() => setMode('draw')} style={[styles.modeButton, mode === 'draw' && styles.modeSelected]}>
            <Text style={[styles.modeText, mode === 'draw' && styles.modeTextSelected]}>✎ Desenhar</Text>
          </Pressable>
        </View>
        {mode === 'write' ? (
          <View style={styles.writeArea}>
            <TextInput
              value={active.text}
              onChangeText={text => setActive(old => ({ ...old, text }))}
              placeholder="Comece a escrever sua redação aqui..."
              placeholderTextColor="#A0A99F"
              multiline
              textAlignVertical="top"
              style={styles.textEditor}
            />
            <Text style={styles.wordCount}>{(active.text || '').trim() ? (active.text || '').trim().split(/\\s+/).length : 0} palavras</Text>
          </View>
        ) : (
          <View style={styles.drawArea}>
            <View style={styles.drawToolbar}>
              <Pressable onPress={() => { if (paths.length) { setRedo(old => [...old, paths[paths.length - 1]]); setPaths(old => old.slice(0, -1)); } }}><Text style={styles.toolText}>↶ Desfazer</Text></Pressable>
              <Pressable onPress={() => { if (redo.length) { setPaths(old => [...old, redo[redo.length - 1]]); setRedo(old => old.slice(0, -1)); } }}><Text style={styles.toolText}>↷ Refazer</Text></Pressable>
              <Pressable onPress={() => Alert.alert('Limpar folha?', 'Apagar todos os traços desta folha?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Limpar', style: 'destructive', onPress: () => { setPaths([]); setRedo([]); } }])}><Text style={styles.toolText}>Limpar</Text></Pressable>
            </View>
            <View style={styles.drawToolsRow}>
              <View style={styles.palette}>
                {COLORS.map(item => <Pressable key={item} onPress={() => setColor(item)} style={[styles.swatch, { backgroundColor: item }, color === item && styles.swatchSelected]} />)}
              </View>
              <Pressable onPress={() => setShowLines(value => !value)} style={[styles.linesToggle, showLines && styles.linesToggleActive]}>
                <Text style={[styles.linesToggleText, showLines && styles.linesToggleTextActive]}>{showLines ? '☷ Linhas' : '□ Sem linhas'}</Text>
              </Pressable>
            </View>
            <View style={styles.canvasModeBar}>
              <Pressable
                onPress={() => { canvasToolRef.current = 'draw'; setCanvasTool('draw'); }}
                style={[styles.canvasModeButton, canvasTool === 'draw' && styles.canvasModeSelected]}
              >
                <Text style={[styles.canvasModeText, canvasTool === 'draw' && styles.canvasModeTextSelected]}>✎ Desenhar</Text>
              </Pressable>
              <Pressable
                onPress={() => { canvasToolRef.current = 'move'; setCanvasTool('move'); activePath.current = null; }}
                style={[styles.canvasModeButton, canvasTool === 'move' && styles.canvasModeSelected]}
              >
                <Text style={[styles.canvasModeText, canvasTool === 'move' && styles.canvasModeTextSelected]}>✋ Mover</Text>
              </Pressable>
            </View>
            <View style={styles.zoomToolbar}>
              <Pressable onPress={() => setZoom(value => { const next = Math.max(1, +(value - 0.25).toFixed(2)); zoomRef.current = next; return next; })} style={styles.zoomButton}><Text style={styles.zoomButtonText}>−</Text></Pressable>
              <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
              <Pressable onPress={() => setZoom(value => { const next = Math.min(3, +(value + 0.25).toFixed(2)); zoomRef.current = next; return next; })} style={styles.zoomButton}><Text style={styles.zoomButtonText}>＋</Text></Pressable>
              <Pressable onPress={() => { zoomRef.current = 1; setZoom(1); panRef.current = { x: 0, y: 0 }; setPan({ x: 0, y: 0 }); }} style={styles.zoomReset}><Text style={styles.zoomResetText}>Ajustar</Text></Pressable>
            </View>
            <View style={styles.paper} {...responder.panHandlers}>
              <Svg width="100%" height="100%">
                <G transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                  {showLines && Array.from({ length: 70 }, (_, index) => (
                    <Line key={index} x1="0" y1={32 + index * 28} x2="1200" y2={32 + index * 28} stroke="#E5EBE5" strokeWidth="1" />
                  ))}
                  {paths.map(path => <Path key={path.id} d={pathData(path.points)} stroke={path.color} strokeWidth={path.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
                </G>
              </Svg>
            </View>
            <Text style={styles.drawHint}>Desenhe ou escreva com o dedo na folha.</Text>
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={PAPER} />
      <View style={styles.header}>
        <Pressable onPress={onExit} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Ambiente de redação</Text>
          <Text style={styles.headerSub}>Escreva suas ideias do seu jeito</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.listContent}>
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Toda boa ideia começa no papel.</Text>
          <Text style={styles.introText}>Crie uma redação, digite pelo teclado ou escreva à mão livre com o dedo.</Text>
        </View>
        <Action label="＋ Nova redação" onPress={createDraft} />
        <Text style={styles.section}>Meus rascunhos</Text>
        {!loaded ? <Text style={styles.emptyText}>Carregando...</Text> : drafts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✎</Text>
            <Text style={styles.emptyTitle}>Nenhuma redação salva</Text>
            <Text style={styles.emptyText}>Seus rascunhos aparecerão aqui.</Text>
          </View>
        ) : drafts.map(draft => (
          <View key={draft.id} style={styles.draftCard}>
            <Pressable onPress={() => openDraft(draft)} style={{ flex: 1 }}>
              <Text style={styles.draftTitle}>{draft.title || 'Sem título'}</Text>
              <Text style={styles.draftMeta}>{draft.mode === 'draw' ? 'Desenho à mão livre' : ((draft.text || '').length + ' caracteres')} · {new Date(draft.updatedAt || Date.now()).toLocaleDateString('pt-BR')}</Text>
            </Pressable>
            <Pressable onPress={() => deleteDraft(draft)} style={styles.delete}><Text style={styles.deleteText}>Excluir</Text></Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAPER },
  header: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: LINE },
  back: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  backText: { color: INK, fontSize: 30, marginTop: -4 },
  headerTitle: { color: INK, fontSize: 17, fontWeight: '800' },
  headerSub: { color: '#89938A', fontSize: 10, marginTop: 3 },
  save: { backgroundColor: INK, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 11 },
  saveText: { color: '#FFF', fontWeight: '700', fontSize: 11 },
  titleInput: { margin: 14, marginBottom: 8, padding: 13, borderRadius: 12, backgroundColor: '#FFF', color: INK, fontSize: 16, fontWeight: '700', borderWidth: 1, borderColor: LINE },
  modeBar: { flexDirection: 'row', marginHorizontal: 14, marginBottom: 10, backgroundColor: '#EAEDE6', borderRadius: 12, padding: 4 },
  modeButton: { flex: 1, padding: 11, alignItems: 'center', borderRadius: 9 },
  modeSelected: { backgroundColor: '#FFF' },
  modeText: { color: '#7C887E', fontSize: 12, fontWeight: '700' },
  modeTextSelected: { color: GREEN },
  writeArea: { flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: LINE, padding: 14 },
  textEditor: { flex: 1, minHeight: 200, color: INK, fontSize: 16, lineHeight: 27 },
  wordCount: { color: '#9AA298', fontSize: 10, textAlign: 'right', marginTop: 8 },
  drawArea: { flex: 1, paddingHorizontal: 14, paddingBottom: 12 },
  drawToolbar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10, backgroundColor: '#FFF', borderRadius: 11, marginBottom: 8 },
  toolText: { color: GREEN, fontSize: 11, fontWeight: '700' },
  drawToolsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  palette: { flexDirection: 'row', gap: 13, paddingVertical: 9 },
  linesToggle: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: '#EAEDE6' },
  linesToggleActive: { backgroundColor: '#DDE9DF' },
  linesToggleText: { color: '#7C887E', fontSize: 10, fontWeight: '700' },
  linesToggleTextActive: { color: GREEN },
  canvasModeBar: { flexDirection: 'row', backgroundColor: '#EAEDE6', borderRadius: 10, padding: 3, marginTop: 7 },
  canvasModeButton: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  canvasModeSelected: { backgroundColor: '#FFF' },
  canvasModeText: { color: '#7C887E', fontSize: 11, fontWeight: '700' },
  canvasModeTextSelected: { color: GREEN },
  zoomToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 8 },
  zoomButton: { width: 32, height: 30, borderRadius: 8, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center' },
  zoomButtonText: { color: INK, fontSize: 18, fontWeight: '700' },
  zoomLabel: { color: INK, fontSize: 11, fontWeight: '700', minWidth: 42, textAlign: 'center' },
  zoomReset: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#FFF' },
  zoomResetText: { color: GREEN, fontSize: 10, fontWeight: '700' },
  swatch: { width: 25, height: 25, borderRadius: 13 },
  swatchSelected: { borderWidth: 3, borderColor: '#A7BDAA' },
  paper: { flex: 1, minHeight: 220, backgroundColor: '#FFF', borderRadius: 10, borderWidth: 1, borderColor: LINE, overflow: 'hidden' },
  drawHint: { color: '#9AA298', fontSize: 10, textAlign: 'center', paddingTop: 8 },
  listContent: { padding: 18, paddingBottom: 35 },
  intro: { backgroundColor: INK, borderRadius: 20, padding: 22, marginBottom: 18 },
  introTitle: { color: '#FFF', fontSize: 23, fontFamily: 'serif', lineHeight: 29 },
  introText: { color: '#D2DED3', fontSize: 12, lineHeight: 19, marginTop: 9 },
  action: { backgroundColor: INK, borderRadius: 13, padding: 15, alignItems: 'center', marginBottom: 24 },
  actionSecondary: { backgroundColor: '#E8F0E9' },
  actionText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  actionTextSecondary: { color: GREEN },
  section: { color: INK, fontSize: 19, fontWeight: '800', marginBottom: 12 },
  empty: { backgroundColor: '#FFF', borderRadius: 16, padding: 23, alignItems: 'center', borderWidth: 1, borderColor: LINE },
  emptyIcon: { color: GREEN, fontSize: 27, marginBottom: 8 },
  emptyTitle: { color: INK, fontSize: 14, fontWeight: '700' },
  emptyText: { color: '#89938A', fontSize: 11, marginTop: 6, textAlign: 'center', lineHeight: 17 },
  draftCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: LINE, padding: 15, marginBottom: 9 },
  draftTitle: { color: INK, fontWeight: '700', fontSize: 14 },
  draftMeta: { color: '#89938A', fontSize: 10, marginTop: 5 },
  delete: { backgroundColor: '#FBEFED', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, marginLeft: 8 },
  deleteText: { color: '#C96F68', fontSize: 10, fontWeight: '700' },
});
