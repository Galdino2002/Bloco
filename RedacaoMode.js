import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, PanResponder, Pressable, ScrollView, Share, StatusBar,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Svg, { G, Line, Path, Rect } from 'react-native-svg';
import { eraseAtPoint, getHighlighterStyle, pathIntersectsPolygon } from './drawing';
import { ContextToolbar, design, IconButton, ScreenHeader } from './designSystem';

const STORAGE_KEY = '@bloco:redacoes:v1';
const BACKUP_KEY = '@bloco:redacoes:backup:v1';

async function writeDraftsWithBackup(items) {
  const previous = await AsyncStorage.getItem(STORAGE_KEY);
  if (previous) {
    try { if (Array.isArray(JSON.parse(previous))) await AsyncStorage.setItem(BACKUP_KEY, previous); } catch { /* preserve the last known good backup */ }
  }
  await writeDraftsWithBackup(items);
}

const INK = '#203B32';
const GREEN = '#315C49';
const PAPER = '#F7F6F1';
const LINE = '#E7E8E1';
const COLORS = ['#202124','#5F6368','#B3261E','#E67C73','#E8710A','#F9AB00','#188038','#34A853','#00796B','#12A594','#1A73E8','#4285F4','#3F51B5','#673AB7','#A142F4','#D81B60','#8D6E63','#FFFFFF'];

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

function getBounds(strokes) {
  const points = strokes.flatMap(stroke => stroke.points || []);
  if (!points.length) return null;
  return { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
}
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 0.00001) + a.x) inside = !inside;
  }
  return inside;
}
function transformSelected(strokes, ids, factor = 1, angle = 0) {
  const box = getBounds(strokes.filter(stroke => ids.includes(stroke.id)));
  if (!box) return strokes;
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  return strokes.map(stroke => ids.includes(stroke.id) ? { ...stroke, width: stroke.width * factor, points: stroke.points.map(p => {
    const x = (p.x - cx) * factor, y = (p.y - cy) * factor;
    return { x: cx + x * Math.cos(angle) - y * Math.sin(angle), y: cy + x * Math.sin(angle) + y * Math.cos(angle) };
  }) } : stroke);
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
  const [draftQuery, setDraftQuery] = useState('');
  const [active, setActive] = useState(null);
  const [mode, setMode] = useState('write');
  const [color, setColor] = useState(COLORS[0]);
  const [paths, setPaths] = useState([]);
  const [redo, setRedo] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [sharingDrawing, setSharingDrawing] = useState(false);
  const [saveState, setSaveState] = useState('saved');
  const autosaveTimer = useRef(null);
  const persistenceQueue = useRef(Promise.resolve());
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [showLines, setShowLines] = useState(true);
  const [canvasTool, setCanvasTool] = useState('draw');
  const canvasToolRef = useRef('draw');
  const [markerType, setMarkerType] = useState('classic');
  const [markerWidth, setMarkerWidth] = useState(18);
  const [penWidth, setPenWidth] = useState(4);
  const [selectedIds, setSelectedIds] = useState([]);
  const [clipboard, setClipboard] = useState([]);
  const [lasso, setLasso] = useState([]);
  const markerTypeRef = useRef('classic');
  const markerWidthRef = useRef(18);
  const penWidthRef = useRef(4);
  const selectedIdsRef = useRef([]);
  const lassoRef = useRef([]);
  const selectionRef = useRef(null);
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
  markerTypeRef.current = markerType;
  markerWidthRef.current = markerWidth;
  penWidthRef.current = penWidth;
  selectedIdsRef.current = selectedIds;
  lassoRef.current = lasso;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(async raw => {
        try { const parsed = raw ? JSON.parse(raw) : []; if (!Array.isArray(parsed)) throw new Error('Armazenamento inválido'); return parsed; }
        catch (error) { const backupRaw = await AsyncStorage.getItem(BACKUP_KEY); if (!backupRaw) throw error; const backup = JSON.parse(backupRaw); if (!Array.isArray(backup)) throw error; await AsyncStorage.setItem(STORAGE_KEY, backupRaw); Alert.alert('Redações recuperadas', 'O Bloco restaurou suas redações a partir do backup automático.'); return backup; }
      })
      .then(setDrafts)
      .catch(() => Alert.alert('Erro', 'Não foi possível carregar suas redações.'))
      .finally(() => setLoaded(true));
  }, []);

  const persist = async (items) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    setDrafts(items);
  };

  const queuePersistDraft = (draft) => {
    if (!draft?.id) return;
    setSaveState('saving');
    persistenceQueue.current = persistenceQueue.current
      .catch(() => undefined)
      .then(async () => {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const current = raw ? JSON.parse(raw) : [];
        const next = current.some(item => item.id === draft.id)
          ? current.map(item => item.id === draft.id ? draft : item)
          : [draft, ...current];
        await writeDraftsWithBackup(next);
        setDrafts(next);
        setSaveState('saved');
      })
      .catch(error => {
        console.error('Erro no salvamento automático da redação:', error);
        setSaveState('error');
        throw error;
      });
    return persistenceQueue.current;
  };

  const openDraft = (draft) => {
    setActive(draft);
    setMode(draft.mode || 'write');
    setPaths(draft.paths || []);
    pathsRef.current = draft.paths || [];
    setRedo([]);
    setSaveState('saved');
  };

  const duplicateDraft = async draft => {
    const copy = {
      ...draft,
      id: String(Date.now()) + '-' + Math.random(),
      title: (draft.title || 'Minha redação') + ' (cópia)',
      updatedAt: Date.now(),
    };
    try {
      await persist([copy, ...drafts]);
    } catch {
      Alert.alert('Erro ao duplicar', 'Não foi possível criar uma cópia desta redação.');
    }
  };

  const createDraft = () => {
    const draft = makeDraft();
    setActive(draft);
    setMode('write');
    setPaths([]);
    pathsRef.current = [];
    setRedo([]);
    setSaveState('saving');
  };

  useEffect(() => {
    if (!active) return undefined;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setSaveState('pending');
    autosaveTimer.current = setTimeout(() => {
      queuePersistDraft({
        ...active,
        mode,
        paths,
        updatedAt: Date.now(),
      });
    }, 700);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [active, mode, paths]);

  const saveDraft = async () => {
    if (!active) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    const updated = { ...active, mode, paths, updatedAt: Date.now() };
    try {
      await queuePersistDraft(updated);
      await persistenceQueue.current;
      setActive(null);
      setSaveState('saved');
      Alert.alert('Redação salva', 'Seu rascunho foi salvo neste aparelho.');
    } catch {
      Alert.alert('Erro ao salvar', 'Não foi possível salvar. Suas alterações continuam abertas; tente novamente.');
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

  const shareDrawingForCorrection = async (criterion) => {
    if (!paths.length) {
      Alert.alert('Folha vazia', 'Faça sua redação na folha antes de solicitar a correção.');
      return;
    }
    if (!canvasRef.current?.toDataURL) {
      Alert.alert('Não foi possível exportar', 'Aguarde um instante e tente novamente.');
      return;
    }

    setSharingDrawing(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        try {
          canvasRef.current.toDataURL(data => {
            if (data) resolve(data);
            else reject(new Error('A imagem não foi gerada.'));
          });
        } catch (error) {
          reject(error);
        }
      });

      const fileName = 'redacao-bloco-' + Date.now() + '.png';
      const fileUri = FileSystem.cacheDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Compartilhamento indisponível', 'Este aparelho não disponibilizou o compartilhamento de imagens.');
        return;
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/png',
        dialogTitle: criterion === 'enem' ? 'Compartilhar redação para correção ENEM' : 'Compartilhar redação para correção geral',
      });
    } catch (error) {
      Alert.alert('Erro ao compartilhar', 'Não foi possível preparar a imagem da redação. Tente novamente.');
    } finally {
      setSharingDrawing(false);
    }
  };

  const shareForCorrection = async (criterion) => {
    const essay = (active?.text || '').trim();
    if (!essay) {
      Alert.alert('Redação vazia', 'Escreva sua redação antes de solicitar a correção.');
      return;
    }

    const instructions = criterion === 'enem'
      ? 'Corrija esta redação seguindo rigorosamente a matriz oficial do ENEM. Avalie separadamente as cinco competências (C1 a C5), atribuindo de 0 a 200 pontos para cada uma, explique cada nota, some a nota final de 0 a 1000, identifique erros e pontos fortes e apresente sugestões práticas de melhoria. Não invente um tema ou uma proposta de intervenção que não esteja no texto. Se o tema da proposta não foi informado, avalie o texto com essa limitação explícita.'
      : 'Faça uma correção geral e criteriosa desta redação. Dê uma nota de 0 a 10 e justifique-a avaliando domínio da escrita, gramática, clareza, estrutura, coesão, coerência, argumentação e conclusão. Aponte erros específicos, pontos fortes e sugestões práticas de melhoria. Não presuma um tema que não foi informado.';

    const message = [
      'Atue como professor(a) de redação e corretor(a) criterioso(a).',
      instructions,
      '',
      'Título: ' + (active.title || 'Sem título'),
      '',
      'REDAÇÃO:',
      essay,
      '',
      'Organize a resposta com a nota, os critérios avaliados, justificativas e recomendações. Seja construtivo e explique como melhorar.',
    ].join('\\n');

    try {
      await Share.share({ message, title: 'Corrigir minha redação' });
    } catch {
      Alert.alert('Não foi possível compartilhar', 'Tente novamente.');
    }
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      const touches = event.nativeEvent.touches || [];
      if (touches.length >= 2) {
        activePath.current = null;
        const [a, b] = touches;
        pinchStart.current = { distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY), zoom: zoomRef.current, centerX: (a.pageX + b.pageX) / 2, centerY: (a.pageY + b.pageY) / 2, pan: panRef.current };
        return;
      }
      const point = { x: (event.nativeEvent.locationX - panRef.current.x) / zoomRef.current, y: (event.nativeEvent.locationY - panRef.current.y) / zoomRef.current };
      if (canvasToolRef.current === 'move') {
        moveStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, pan: panRef.current };
        return;
      }
      if (canvasToolRef.current === 'select') {
        activePath.current = null;
        if (selectedIdsRef.current.length) {
          const box = getBounds(pathsRef.current.filter(stroke => selectedIdsRef.current.includes(stroke.id)));
          const center = box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : point;
          const handle = box ? { x: box.maxX + 7, y: box.maxY + 7 } : point;
          if (box && Math.hypot(point.x - handle.x, point.y - handle.y) < 28) {
            selectionRef.current = { type: 'resize', center, startDistance: Math.max(1, Math.hypot(handle.x - center.x, handle.y - center.y)), original: pathsRef.current, factor: 1 };
          } else selectionRef.current = { type: 'move', start: point, original: pathsRef.current };
        } else {
          selectionRef.current = { type: 'lasso' };
          lassoRef.current = [point]; setLasso([point]);
        }
        return;
      }
      if (canvasToolRef.current === 'eraser') {
        const next = eraseAtPoint(pathsRef.current, point, 24);
        pathsRef.current = next; setPaths(next); setRedo([]); return;
      }
      const isMarker = canvasToolRef.current === 'highlighter';
      const marker = markerTypeRef.current;
      const markerStyle = getHighlighterStyle(marker, markerWidthRef.current);
      const stroke = { id: String(Date.now()) + Math.random(), points: [point], color: colorRef.current, width: isMarker ? markerStyle.width : penWidthRef.current, opacity: isMarker ? markerStyle.opacity : 1, kind: isMarker ? 'highlighter' : 'pen' };
      activePath.current = stroke; pathsRef.current = [...pathsRef.current, stroke]; setPaths(pathsRef.current); setRedo([]);
    },
    onPanResponderMove: event => {
      const touches = event.nativeEvent.touches || [];
      if (touches.length >= 2) {
        activePath.current = null;
        const [a, b] = touches;
        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        if (!pinchStart.current && distance > 0) pinchStart.current = { distance, zoom: zoomRef.current, centerX: (a.pageX + b.pageX) / 2, centerY: (a.pageY + b.pageY) / 2, pan: panRef.current };
        if (pinchStart.current?.distance && distance > 0) {
          const nextZoom = Math.max(0.25, Math.min(3, pinchStart.current.zoom * distance / pinchStart.current.distance));
          zoomRef.current = nextZoom; setZoom(nextZoom);
          const centerX = (a.pageX + b.pageX) / 2, centerY = (a.pageY + b.pageY) / 2;
          const nextPan = { x: pinchStart.current.pan.x + centerX - pinchStart.current.centerX, y: pinchStart.current.pan.y + centerY - pinchStart.current.centerY };
          panRef.current = nextPan; setPan(nextPan);
        }
        return;
      }
      pinchStart.current = null;
      const point = { x: (event.nativeEvent.locationX - panRef.current.x) / zoomRef.current, y: (event.nativeEvent.locationY - panRef.current.y) / zoomRef.current };
      if (canvasToolRef.current === 'move' && moveStart.current) {
        const nextPan = { x: moveStart.current.pan.x + event.nativeEvent.pageX - moveStart.current.x, y: moveStart.current.pan.y + event.nativeEvent.pageY - moveStart.current.y };
        panRef.current = nextPan; setPan(nextPan); return;
      }
      if (canvasToolRef.current === 'select' && selectionRef.current?.type === 'lasso') {
        const next = [...lassoRef.current, point]; lassoRef.current = next; setLasso(next); return;
      }
      if (canvasToolRef.current === 'select' && selectionRef.current?.type === 'move') {
        const dx = point.x - selectionRef.current.start.x, dy = point.y - selectionRef.current.start.y;
        const moved = selectionRef.current.original.map(stroke => selectedIdsRef.current.includes(stroke.id) ? { ...stroke, points: stroke.points.map(p => ({ x: p.x + dx, y: p.y + dy })) } : stroke);
        pathsRef.current = moved; setPaths(moved); return;
      }
      if (canvasToolRef.current === 'select' && selectionRef.current?.type === 'resize') {
        const factor = Math.max(0.25, Math.min(4, Math.hypot(point.x - selectionRef.current.center.x, point.y - selectionRef.current.center.y) / selectionRef.current.startDistance));
        selectionRef.current.factor = factor;
        const resized = transformSelected(selectionRef.current.original, selectedIdsRef.current, factor);
        pathsRef.current = resized; setPaths(resized); return;
      }
      if (canvasToolRef.current === 'eraser') {
        const next = eraseAtPoint(pathsRef.current, point, 24);
        if (next.length !== pathsRef.current.length) { pathsRef.current = next; setPaths(next); }
        return;
      }
      if (!activePath.current) return;
      const updated = { ...activePath.current, points: [...activePath.current.points, point] };
      activePath.current = updated; pathsRef.current = [...pathsRef.current.slice(0, -1), updated]; setPaths(pathsRef.current);
    },
    onPanResponderRelease: () => {
      if (canvasToolRef.current === 'select' && selectionRef.current?.type === 'lasso') {
        const polygon = lassoRef.current;
        const ids=polygon.length>=3 ? pathsRef.current.filter(stroke=>pathIntersectsPolygon(stroke, polygon)).map(stroke=>stroke.id) : [];
        selectedIdsRef.current = ids; setSelectedIds(ids); lassoRef.current = []; setLasso([]);
      } else if (canvasToolRef.current === 'select' && selectionRef.current?.type === 'resize') {
        const resized = transformSelected(selectionRef.current.original, selectedIdsRef.current, selectionRef.current.factor || 1);
        pathsRef.current = resized; setPaths(resized); setRedo([]);
      } else if (canvasToolRef.current === 'select' && selectionRef.current?.type === 'move') {
        setRedo([]);
      }
      selectionRef.current = null; activePath.current = null; pinchStart.current = null; moveStart.current = null;
    },
    onPanResponderTerminate: () => { activePath.current = null; pinchStart.current = null; moveStart.current = null; selectionRef.current = null; lassoRef.current = []; setLasso([]); },
  }), []);

  if (active) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={PAPER} />
        <View style={[styles.header, { backgroundColor: design.colors.ink, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16 }]}>
          <Pressable onPress={saveDraft} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: design.colors.white }]}>Ambiente de redação</Text>
            <Text style={styles.headerSub}>{saveState === 'saving' || saveState === 'pending' ? 'Salvando automaticamente...' : saveState === 'error' ? 'Não foi possível salvar automaticamente' : 'Tudo salvo neste aparelho'}</Text>
          </View>
          <IconButton label="✓" accessibilityLabel="Salvar redação" onPress={saveDraft} active />
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
            <Text style={styles.correctionCaption}>Peça ao ChatGPT para avaliar seu texto</Text>
            <View style={styles.correctionButtons}>
              <Pressable onPress={() => shareForCorrection('enem')} style={styles.correctionButton}>
                <Text style={styles.correctionButtonTitle}>Corrigir pelo ENEM</Text>
                <Text style={styles.correctionButtonSub}>Nota de 0 a 1.000</Text>
              </Pressable>
              <Pressable onPress={() => shareForCorrection('geral')} style={[styles.correctionButton, styles.correctionButtonSecondary]}>
                <Text style={[styles.correctionButtonTitle, styles.correctionButtonTitleSecondary]}>Correção geral</Text>
                <Text style={[styles.correctionButtonSub, styles.correctionButtonSubSecondary]}>Nota de 0 a 10</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.drawArea}>
            <ContextToolbar>
              <IconButton label="↶" accessibilityLabel="Desfazer" onPress={() => { if (paths.length) { setRedo(old => [...old, paths[paths.length - 1]]); setPaths(old => old.slice(0, -1)); } }} disabled={!paths.length} />
              <IconButton label="↷" accessibilityLabel="Refazer" onPress={() => { if (redo.length) { setPaths(old => [...old, redo[redo.length - 1]]); setRedo(old => old.slice(0, -1)); } }} disabled={!redo.length} />
              <Pressable onPress={() => Alert.alert('Limpar folha?', 'Apagar todos os traços desta folha?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Limpar', style: 'destructive', onPress: () => { setPaths([]); setRedo([]); } }])}><Text style={styles.toolText}>Limpar</Text></Pressable>
            </ContextToolbar>
            <View style={styles.canvasModeBar}>
              {[
                ['draw', '✎ Caneta'], ['highlighter', '▰ Marca-texto'], ['eraser', '⌫ Borracha'],
                ['select', '⌁ Laço'], ['move', '✥ Mover folha'],
              ].map(([id, label]) => <Pressable key={id} onPress={() => { canvasToolRef.current = id; setCanvasTool(id); activePath.current = null; if (id !== 'select') { setSelectedIds([]); setLasso([]); } }} style={[styles.canvasModeButton, canvasTool === id && styles.canvasModeSelected]}><Text style={[styles.canvasModeText, canvasTool === id && styles.canvasModeTextSelected]}>{label}</Text></Pressable>)}
            </View>
            {canvasTool === 'select' && <View style={styles.selectionToolbar}>
              <Text style={styles.selectionHint}>{selectedIds.length ? `${selectedIds.length} selecionado(s) · arraste para mover ou use os atalhos.` : 'Contorne a escrita com o dedo para selecionar.'}</Text>
              {selectedIds.length > 0 && <View style={styles.selectionActions}>
                <Pressable style={styles.selectionAction} onPress={() => { const next = transformSelected(paths, selectedIds, 1.15); pathsRef.current = next; setPaths(next); setRedo([]); }}><Text style={styles.toolText}>＋ Tamanho</Text></Pressable>
                <Pressable style={styles.selectionAction} onPress={() => { const next = transformSelected(paths, selectedIds, 0.87); pathsRef.current = next; setPaths(next); setRedo([]); }}><Text style={styles.toolText}>− Tamanho</Text></Pressable>
                <Pressable style={styles.selectionAction} onPress={() => { const next = transformSelected(paths, selectedIds, 1, Math.PI / 12); pathsRef.current = next; setPaths(next); setRedo([]); }}><Text style={styles.toolText}>↻ Girar</Text></Pressable>
                <Pressable style={styles.selectionAction} onPress={() => { setClipboard(paths.filter(path => selectedIds.includes(path.id))); const next = paths.filter(path => !selectedIds.includes(path.id)); pathsRef.current = next; setPaths(next); setSelectedIds([]); setRedo([]); }}><Text style={styles.toolText}>Cortar</Text></Pressable>
                <Pressable style={styles.selectionAction} onPress={() => { if (!clipboard.length) return; const pasted = clipboard.map(path => ({ ...path, id: String(Date.now()) + Math.random(), points: path.points.map(p => ({ x: p.x + 24, y: p.y + 24 })) })); const next = [...paths, ...pasted]; pathsRef.current = next; setPaths(next); setSelectedIds(pasted.map(path => path.id)); setRedo([]); }}><Text style={styles.toolText}>Colar</Text></Pressable>
                <Pressable style={styles.selectionAction} onPress={() => { const next = paths.filter(path => !selectedIds.includes(path.id)); pathsRef.current = next; setPaths(next); setSelectedIds([]); setRedo([]); }}><Text style={[styles.toolText, { color: '#B44D45' }]}>Excluir</Text></Pressable>
                <Pressable style={styles.selectionAction} onPress={() => setSelectedIds([])}><Text style={styles.toolText}>Nova seleção</Text></Pressable>
              </View>}
            </View>}
            {canvasTool === 'draw' && <View style={styles.penWidths}><Text style={styles.markerLabel}>ESPESSURA</Text>{[2,4,7].map(width => <Pressable key={width} onPress={() => setPenWidth(width)} style={[styles.penWidthButton, penWidth === width && styles.penWidthButtonActive]}><View style={{ width: width + 3, height: width + 3, borderRadius: 10, backgroundColor: INK }} /></Pressable>)}</View>}
            {canvasTool === 'highlighter' && <View style={styles.markerTypes}>
              <View style={styles.markerWidthRow}><Text style={styles.markerLabel}>ESPESSURA</Text>{[10, 18, 28].map(width => <Pressable key={width} onPress={() => setMarkerWidth(width)} style={[styles.markerWidthButton, markerWidth === width && styles.markerWidthButtonActive]}><View style={[styles.markerWidthPreview, { height: Math.min(18, Math.max(6, width / 1.5)) }]} /></Pressable>)}</View>
              <Text style={styles.markerLabel}>ESTILO</Text>
              {[['classic','Clássico'],['pastel','Pastel'],['bold','Forte'],['underline','Sublinhado']].map(([id,label]) => <Pressable key={id} onPress={() => setMarkerType(id)} style={[styles.markerType, markerType === id && styles.markerTypeActive]}><Text style={[styles.markerTypeText, markerType === id && styles.markerTypeTextActive]}>{label}</Text></Pressable>)}
            </View>}
            <View style={styles.drawToolsRow}>
              <ScrollView horizontal style={{ flex: 1 }} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.palette}>
                {COLORS.map(item => <Pressable key={item} onPress={() => setColor(item)} style={[styles.swatch, { backgroundColor: item, borderWidth: item === '#FFFFFF' ? 1 : 0, borderColor: '#AEB5AE' }, color === item && styles.swatchSelected]} />)}
              </ScrollView>
              <Pressable onPress={() => setShowLines(value => !value)} style={[styles.linesToggle, showLines && styles.linesToggleActive]}>
                <Text style={[styles.linesToggleText, showLines && styles.linesToggleTextActive]}>{showLines ? '☷ Linhas' : '□ Sem linhas'}</Text>
              </Pressable>
            </View>
            <View style={styles.zoomToolbar}>
              <Pressable onPress={() => setZoom(value => { const next = Math.max(0.25, +(value - 0.1).toFixed(2)); zoomRef.current = next; return next; })} style={styles.zoomButton}><Text style={styles.zoomButtonText}>−</Text></Pressable>
              <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
              <Pressable onPress={() => setZoom(value => { const next = Math.min(3, +(value + 0.1).toFixed(2)); zoomRef.current = next; return next; })} style={styles.zoomButton}><Text style={styles.zoomButtonText}>＋</Text></Pressable>
              <Pressable onPress={() => { zoomRef.current = 1; setZoom(1); panRef.current = { x: 0, y: 0 }; setPan({ x: 0, y: 0 }); }} style={styles.zoomReset}><Text style={styles.zoomResetText}>Ajustar</Text></Pressable>
              <Pressable
                disabled={sharingDrawing}
                onPress={() => Alert.alert('Corrigir redação', 'Escolha o tipo de correção:', [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Pelo ENEM (0–1.000)', onPress: () => shareDrawingForCorrection('enem') },
                  { text: 'Correção geral (0–10)', onPress: () => shareDrawingForCorrection('geral') },
                ])}
                style={[styles.zoomReset, styles.correctDrawingButton, sharingDrawing && styles.correctionButtonDisabled]}
              >
                <Text style={styles.correctDrawingButtonText}>{sharingDrawing ? 'Preparando...' : 'Corrigir desenho'}</Text>
              </Pressable>
            </View>
            <View style={styles.paper} {...responder.panHandlers}>
              <Svg ref={canvasRef} width="100%" height="100%">
                <G transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                  {showLines && Array.from({ length: 70 }, (_, index) => (
                    <Line key={index} x1="0" y1={32 + index * 28} x2="1200" y2={32 + index * 28} stroke="#E5EBE5" strokeWidth="1" />
                  ))}
                  {paths.map(path => <Path key={path.id} d={pathData(path.points)} stroke={path.color} strokeOpacity={path.opacity ?? 1} strokeWidth={path.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}{lasso.length > 1 && <Path d={pathData(lasso)} stroke={GREEN} strokeWidth={2} strokeDasharray="6 4" fill="none" />}{selectedIds.length > 0 && (() => { const b = getBounds(paths.filter(path => selectedIds.includes(path.id))); return b ? <><Rect x={b.minX - 7} y={b.minY - 7} width={Math.max(20, b.maxX - b.minX + 14)} height={Math.max(20, b.maxY - b.minY + 14)} stroke={GREEN} strokeWidth={1.5} strokeDasharray="5 4" fill="none" /><Rect x={b.maxX + 1} y={b.maxY + 1} width={12} height={12} rx={3} fill={GREEN} /></> : null; })()}
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
      <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
        <ScreenHeader
          eyebrow="BLOCO · PRODUÇÃO TEXTUAL"
          title="Ambiente de redação"
          subtitle="Escreva, revise e acompanhe seus rascunhos"
          onBack={onExit}
        />
      </View>
      <ScrollView contentContainerStyle={styles.listContent}>
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Toda boa ideia começa no papel.</Text>
          <Text style={styles.introText}>Crie uma redação, digite pelo teclado ou escreva à mão livre com o dedo.</Text>
        </View>
        <Action label="＋ Nova redação" onPress={createDraft} />
        <Text style={styles.section}>Meus rascunhos</Text>
        <View style={styles.draftSearchBox}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput value={draftQuery} onChangeText={setDraftQuery} placeholder="Buscar redações pelo título ou texto" placeholderTextColor="#89938A" style={styles.draftSearchInput} />
          {!!draftQuery && <Pressable onPress={() => setDraftQuery('')} accessibilityRole="button" accessibilityLabel="Limpar busca"><Text style={styles.searchClear}>×</Text></Pressable>}
        </View>
        {!loaded ? <Text style={styles.emptyText}>Carregando...</Text> : drafts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✎</Text>
            <Text style={styles.emptyTitle}>Nenhuma redação salva</Text>
            <Text style={styles.emptyText}>Seus rascunhos aparecerão aqui.</Text>
          </View>
        ) : drafts.filter(draft => `${draft.title || ''} ${draft.text || ''}`.toLocaleLowerCase().includes(draftQuery.trim().toLocaleLowerCase())).length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyTitle}>Nenhuma redação encontrada</Text><Text style={styles.emptyText}>Tente outro título ou trecho do texto.</Text></View>
        ) : drafts.filter(draft => `${draft.title || ''} ${draft.text || ''}`.toLocaleLowerCase().includes(draftQuery.trim().toLocaleLowerCase())).map(draft => (
          <View key={draft.id} style={styles.draftCard}>
            <Pressable onPress={() => openDraft(draft)} style={{ flex: 1 }}>
              <Text style={styles.draftTitle}>{draft.title || 'Sem título'}</Text>
              <Text style={styles.draftMeta}>{draft.mode === 'draw' ? 'Desenho à mão livre' : ((draft.text || '').length + ' caracteres')} · {new Date(draft.updatedAt || Date.now()).toLocaleDateString('pt-BR')}</Text>
            </Pressable>
            <Pressable onPress={() => duplicateDraft(draft)} style={styles.draftDuplicate} accessibilityRole="button" accessibilityLabel={`Duplicar ${draft.title || 'redação'}`}><Text style={styles.draftDuplicateText}>Duplicar</Text></Pressable>
            <Pressable onPress={() => deleteDraft(draft)} style={styles.delete}><Text style={styles.deleteText}>Excluir</Text></Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F2EF' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#FFF', borderBottomWidth: 1, borderColor: LINE },
  back: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  backText: { color: INK, fontSize: 30, marginTop: -4 },
  headerTitle: { color: INK, fontSize: 17, fontWeight: '800' },
  headerSub: { color: '#89938A', fontSize: 10, marginTop: 3 },
  save: { backgroundColor: INK, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 11 },
  saveText: { color: '#FFF', fontWeight: '700', fontSize: 11 },
  titleInput: { marginHorizontal: 12, marginTop: 10, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 13, backgroundColor: '#FFFFFF', color: INK, fontSize: 16, fontWeight: '700', borderWidth: 1, borderColor: '#E4E7E2' },
  modeBar: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 9, backgroundColor: '#E6E9E4', borderRadius: 14, padding: 4, borderWidth: 1, borderColor: '#DDE2DC' },
  modeButton: { flex: 1, padding: 11, alignItems: 'center', borderRadius: 9 },
  modeSelected: { backgroundColor: '#FFF' },
  modeText: { color: '#7C887E', fontSize: 12, fontWeight: '700' },
  modeTextSelected: { color: GREEN },
  writeArea: { flex: 1, marginHorizontal: 12, marginBottom: 12, backgroundColor: '#FFFFFF', borderRadius: 6, borderWidth: 1, borderColor: '#E3E6E1', padding: 18, elevation: 2, shadowColor: '#202522', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  textEditor: { flex: 1, minHeight: 200, color: INK, fontSize: 16, lineHeight: 27 },
  wordCount: { color: '#9AA298', fontSize: 10, textAlign: 'right', marginTop: 8 },
  correctionCaption: { color: GREEN, fontSize: 11, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  correctionButtons: { flexDirection: 'row', gap: 8 },
  correctionButton: { flex: 1, backgroundColor: INK, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 8, alignItems: 'center' },
  correctionButtonSecondary: { backgroundColor: '#E8F0E9' },
  correctionButtonTitle: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  correctionButtonTitleSecondary: { color: GREEN },
  correctionButtonSub: { color: '#D2DED3', fontSize: 9, marginTop: 4 },
  correctionButtonSubSecondary: { color: '#718477' },
  correctionButtonDisabled: { opacity: 0.55 },
  drawArea: { flex: 1, paddingHorizontal: 10, paddingBottom: 9, backgroundColor: '#F1F2EF' },
  selectionToolbar: { backgroundColor: '#F7F9F5', borderRadius: 10, padding: 9, marginTop: 7, marginBottom: 6 },
  selectionHint: { color: '#77847A', fontSize: 10, marginBottom: 7 },
  selectionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  selectionAction: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: '#E8F0E9', borderWidth: 1, borderColor: '#D4E2D6' },
  markerTypes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 7 },
  markerWidthRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  markerWidthButton: { width: 50, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F2EE', borderWidth: 1, borderColor: '#E3E6DF' },
  markerWidthButtonActive: { backgroundColor: '#DCEBDD', borderColor: GREEN },
  markerWidthPreview: { width: 30, borderRadius: 10, backgroundColor: '#E4B83F', opacity: 0.55 },
  penWidths: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 },
  penWidthButton: { width: 29, height: 27, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  penWidthButtonActive: { borderColor: '#B8CDBB', backgroundColor: '#F4F7F2' },
  markerLabel: { color: GREEN, fontSize: 9, fontWeight: '800', marginRight: 3 },
  markerType: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F1F2EE', borderWidth: 1, borderColor: '#E3E6DF' },
  markerTypeActive: { backgroundColor: '#DCEBDD', borderColor: GREEN },
  markerTypeText: { color: '#667269', fontSize: 9, fontWeight: '600' },
  markerTypeTextActive: { color: GREEN, fontWeight: '800' },

  drawToolbar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 9, paddingHorizontal: 5, backgroundColor: '#FFFFFF', borderRadius: 15, marginBottom: 8, borderWidth: 1, borderColor: '#E4E7E2' },
  toolText: { color: GREEN, fontSize: 11, fontWeight: '700' },
  drawToolsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  palette: { flexDirection: 'row', gap: 10, paddingVertical: 9, alignItems: 'center' },
  linesToggle: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: '#EAEDE6' },
  linesToggleActive: { backgroundColor: '#DDE9DF' },
  linesToggleText: { color: '#7C887E', fontSize: 10, fontWeight: '700' },
  linesToggleTextActive: { color: GREEN },
  canvasModeBar: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#E6E9E4', borderRadius: 13, padding: 4, marginTop: 7, borderWidth: 1, borderColor: '#DDE2DC' },
  canvasModeButton: { flexGrow: 1, minWidth: 88, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  canvasModeSelected: { backgroundColor: '#FFF' },
  canvasModeText: { color: '#7C887E', fontSize: 11, fontWeight: '700' },
  canvasModeTextSelected: { color: GREEN },
  zoomToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5, paddingVertical: 6 },
  zoomButton: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center' },
  zoomButtonText: { color: INK, fontSize: 18, fontWeight: '700' },
  zoomLabel: { color: INK, fontSize: 11, fontWeight: '700', minWidth: 42, textAlign: 'center' },
  zoomReset: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#FFF' },
  zoomResetText: { color: GREEN, fontSize: 10, fontWeight: '700' },
  correctDrawingButton: { backgroundColor: INK, paddingHorizontal: 9, paddingVertical: 9 },
  correctDrawingButtonText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  swatch: { width: 25, height: 25, borderRadius: 13 },
  swatchSelected: { borderWidth: 3, borderColor: '#A7BDAA' },
  paper: { flex: 1, minHeight: 220, backgroundColor: '#FFFFFF', borderRadius: 5, borderWidth: 1, borderColor: '#E3E6E1', overflow: 'hidden', elevation: 2, shadowColor: '#202522', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
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
  draftSearchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7E2', borderRadius: 13, paddingHorizontal: 12, marginBottom: 13 },
  searchGlyph: { color: GREEN, fontSize: 22, marginRight: 8 },
  draftSearchInput: { flex: 1, color: INK, fontSize: 12, paddingVertical: 11 },
  searchClear: { color: '#89938A', fontSize: 22, paddingHorizontal: 5 },
  draftDuplicate: { paddingHorizontal: 9, paddingVertical: 8, borderRadius: 9, backgroundColor: '#E8F0E9', marginLeft: 6 },
  draftDuplicateText: { color: GREEN, fontSize: 9, fontWeight: '800' },
  draftCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: LINE, padding: 15, marginBottom: 9 },
  draftTitle: { color: INK, fontWeight: '700', fontSize: 14 },
  draftMeta: { color: '#89938A', fontSize: 10, marginTop: 5 },
  delete: { backgroundColor: '#FBEFED', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, marginLeft: 8 },
  deleteText: { color: '#C96F68', fontSize: 10, fontWeight: '700' },
});
