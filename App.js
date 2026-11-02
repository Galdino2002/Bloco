import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Path } from 'react-native-svg';

const COLORS = {
  ink: '#203B32',
  green: '#315C49',
  greenLight: '#E8F0E9',
  paper: '#F7F6F1',
  white: '#FFFFFF',
  muted: '#89938A',
  line: '#E7E8E1',
  orange: '#D99A58',
  rose: '#C96F68',
  blue: '#6385A5',
};

const PALETTE = ['#203B32', '#D85D52', '#477BA8', '#D99A35', '#7659A6'];

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function pathToSvg(points) {
  if (!points.length) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function IconText({ children, color = COLORS.ink, size = 18 }) {
  return <Text style={{ color, fontSize: size, fontWeight: '600' }}>{children}</Text>;
}

function ActionButton({ label, onPress, secondary = false, compact = false }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        secondary && styles.actionButtonSecondary,
        compact && styles.actionButtonCompact,
        pressed && { opacity: 0.78, transform: [{ scale: 0.98 }] },
      ]}
    >
      <Text style={[styles.actionButtonText, secondary && styles.actionButtonTextSecondary, compact && { fontSize: 13 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function HomeScreen({ documents, onImport, onOpen }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.paper} />
      <ScrollView contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Bloco</Text>
            <Text style={styles.headerSubtitle}>seu espaço de ideias</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>B</Text>
          </View>
        </View>

        <View style={styles.welcomeRow}>
          <View>
            <Text style={styles.eyebrow}>SEU CANTINHO DE ESTUDOS</Text>
            <Text style={styles.welcomeTitle}>Tudo pronto para{ '\n' }colocar no papel.</Text>
          </View>
          <Text style={styles.sparkle}>✳</Text>
        </View>

        <Pressable onPress={onImport} style={({ pressed }) => [styles.heroCard, pressed && { opacity: 0.92 }]}>
          <View style={styles.heroTopLine}>
            <View style={styles.heroTag}><Text style={styles.heroTagText}>NOVO DOCUMENTO</Text></View>
            <Text style={styles.heroArrow}>↗</Text>
          </View>
          <View style={styles.heroIllustration}>
            <View style={styles.paperBack} />
            <View style={styles.paperFront}>
              <View style={styles.paperLineLong} />
              <View style={styles.paperLineShort} />
              <View style={styles.paperCircle}><Text style={styles.paperCheck}>✓</Text></View>
              <View style={styles.paperLineMedium} />
            </View>
            <View style={styles.pencil}><Text style={styles.pencilText}>✎</Text></View>
          </View>
          <Text style={styles.heroTitle}>Sua próxima ideia{ '\n' }começa aqui.</Text>
          <Text style={styles.heroDescription}>Importe uma prova, atividade ou imagem e escreva por cima dela.</Text>
          <View style={styles.heroButton}>
            <Text style={styles.heroButtonText}>＋  Importar imagem</Text>
          </View>
        </Pressable>

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>Seu espaço</Text>
            <Text style={styles.sectionSubtitle}>Continue de onde parou</Text>
          </View>
          <Text style={styles.documentCount}>{documents.length.toString().padStart(2, '0')}</Text>
        </View>

        {documents.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><Text style={{ fontSize: 22 }}>▤</Text></View>
            <Text style={styles.emptyTitle}>Ainda não há páginas</Text>
            <Text style={styles.emptyText}>Quando você importar uma imagem e começar a escrever, seus documentos aparecerão aqui.</Text>
          </View>
        ) : (
          <View style={styles.documentList}>
            {documents.map((document, index) => (
              <Pressable key={document.id} onPress={() => onOpen(document)} style={({ pressed }) => [styles.documentCard, pressed && { opacity: 0.8 }]}>
                <View style={styles.documentThumb}>
                  <Image source={{ uri: document.uri }} style={styles.documentThumbImage} />
                  <View style={styles.thumbBadge}><Text style={styles.thumbBadgeText}>✎</Text></View>
                </View>
                <View style={styles.documentInfo}>
                  <Text style={styles.documentName} numberOfLines={1}>{document.title || `Minha página ${index + 1}`}</Text>
                  <Text style={styles.documentMeta}>{document.paths.length} {document.paths.length === 1 ? 'anotação' : 'anotações'} · aberto recentemente</Text>
                </View>
                <Text style={styles.documentArrow}>›</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.footerNote}>
          <Text style={styles.footerLeaf}>✳</Text>
          <Text style={styles.footerText}>Um espaço simples. Para ideias grandes.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function EditorScreen({ document, onBack, onSave }) {
  const [paths, setPaths] = useState(document.paths || []);
  const [redoPaths, setRedoPaths] = useState([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(PALETTE[0]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const activePath = useRef(null);
  const pathsRef = useRef(paths);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const widthRef = useRef(strokeWidth);

  pathsRef.current = paths;
  toolRef.current = tool;
  colorRef.current = color;
  widthRef.current = strokeWidth;

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const point = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
      if (toolRef.current === 'eraser') {
        const next = pathsRef.current.filter((path) => {
          if (!path.points.length) return true;
          if (path.points.length === 1) return Math.hypot(path.points[0].x - point.x, path.points[0].y - point.y) > 22;
          for (let i = 1; i < path.points.length; i += 1) {
            if (distanceToSegment(point, path.points[i - 1], path.points[i]) < 22) return false;
          }
          return true;
        });
        setPaths(next);
        pathsRef.current = next;
        setRedoPaths([]);
        return;
      }
      const nextPath = { id: `${Date.now()}-${Math.random()}`, points: [point], color: colorRef.current, width: widthRef.current };
      activePath.current = nextPath;
      setPaths((previous) => [...previous, nextPath]);
      setRedoPaths([]);
    },
    onPanResponderMove: (event) => {
      const point = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
      if (toolRef.current === 'eraser') {
        const next = pathsRef.current.filter((path) => {
          for (let i = 0; i < path.points.length; i += 1) {
            if (Math.hypot(path.points[i].x - point.x, path.points[i].y - point.y) < 22) return false;
          }
          return true;
        });
        if (next.length !== pathsRef.current.length) {
          pathsRef.current = next;
          setPaths(next);
        }
        return;
      }
      if (!activePath.current) return;
      const updated = { ...activePath.current, points: [...activePath.current.points, point] };
      activePath.current = updated;
      setPaths((previous) => [...previous.slice(0, -1), updated]);
    },
    onPanResponderRelease: () => { activePath.current = null; },
    onPanResponderTerminate: () => { activePath.current = null; },
  }), []);

  const undo = () => {
    if (!paths.length) return;
    setRedoPaths((previous) => [...previous, paths[paths.length - 1]]);
    setPaths((previous) => previous.slice(0, -1));
  };

  const redo = () => {
    if (!redoPaths.length) return;
    setPaths((previous) => [...previous, redoPaths[redoPaths.length - 1]]);
    setRedoPaths((previous) => previous.slice(0, -1));
  };

  const save = () => onSave({ ...document, paths, updatedAt: Date.now() });

  return (
    <SafeAreaView style={styles.editorSafe}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.paper} />
      <View style={styles.editorHeader}>
        <Pressable onPress={save} style={styles.backButton}><Text style={styles.backArrow}>‹</Text></Pressable>
        <View style={styles.editorTitleWrap}>
          <Text style={styles.editorTitle}>Área de escrita</Text>
          <Text style={styles.editorSubtitle}>Suas anotações ficam sobre a imagem</Text>
        </View>
        <Pressable onPress={save} style={styles.saveButton}><Text style={styles.saveButtonText}>Salvar</Text></Pressable>
      </View>

      <View style={styles.editorToolbar}>
        <Pressable onPress={undo} disabled={!paths.length} style={[styles.toolButton, !paths.length && styles.toolDisabled]}>
          <Text style={styles.toolGlyph}>↶</Text><Text style={styles.toolLabel}>Desfazer</Text>
        </Pressable>
        <Pressable onPress={redo} disabled={!redoPaths.length} style={[styles.toolButton, !redoPaths.length && styles.toolDisabled]}>
          <Text style={styles.toolGlyph}>↷</Text><Text style={styles.toolLabel}>Refazer</Text>
        </Pressable>
        <View style={styles.toolbarDivider} />
        <Pressable onPress={() => setPaths([])} style={styles.toolButton}>
          <Text style={styles.toolGlyph}>⌫</Text><Text style={styles.toolLabel}>Limpar</Text>
        </Pressable>
        <View style={styles.editorSpacer} />
        <View style={styles.pageCounter}><Text style={styles.pageCounterText}>01 / 01</Text></View>
      </View>

      <View style={styles.canvasArea}>
        <View style={styles.canvasPaper} onLayout={(event) => setCanvasSize(event.nativeEvent.layout)}>
          <Image source={{ uri: document.uri }} style={styles.examImage} resizeMode="contain" />
          <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
            <Svg width={canvasSize.width} height={canvasSize.height}>
              {paths.map((path) => (
                <Path
                  key={path.id}
                  d={pathToSvg(path.points)}
                  stroke={path.color}
                  strokeWidth={path.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ))}
            </Svg>
          </View>
        </View>
        <View style={styles.canvasHint}><Text style={styles.canvasHintText}>✎  Desenhe com o dedo sobre a folha</Text></View>
      </View>

      <View style={styles.drawingPanel}>
        <View style={styles.toolModeRow}>
          <Pressable onPress={() => setTool('pen')} style={[styles.modeButton, tool === 'pen' && styles.modeButtonActive]}>
            <Text style={[styles.modeGlyph, tool === 'pen' && styles.modeGlyphActive]}>✎</Text>
            <Text style={[styles.modeText, tool === 'pen' && styles.modeTextActive]}>Caneta</Text>
          </Pressable>
          <Pressable onPress={() => setTool('eraser')} style={[styles.modeButton, tool === 'eraser' && styles.modeButtonActive]}>
            <Text style={[styles.modeGlyph, tool === 'eraser' && styles.modeGlyphActive]}>▱</Text>
            <Text style={[styles.modeText, tool === 'eraser' && styles.modeTextActive]}>Borracha</Text>
          </Pressable>
          <View style={styles.panelDivider} />
          <View style={styles.widthOptions}>
            {[2, 4, 7].map((width) => (
              <Pressable key={width} onPress={() => { setStrokeWidth(width); setTool('pen'); }} style={[styles.widthButton, strokeWidth === width && tool === 'pen' && styles.widthButtonActive]}>
                <View style={[styles.widthDot, { width: width + 3, height: width + 3 }]} />
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.colorRow}>
          <Text style={styles.colorLabel}>COR</Text>
          {PALETTE.map((item) => (
            <Pressable key={item} onPress={() => { setColor(item); setTool('pen'); }} style={[styles.colorButton, color === item && tool === 'pen' && styles.colorButtonSelected]}>
              <View style={[styles.colorDot, { backgroundColor: item }]} />
            </Pressable>
          ))}
          <View style={styles.panelSpacer} />
          <Text style={styles.annotationCount}>{paths.length} traços</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [activeDocument, setActiveDocument] = useState(null);

  const importImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const newDocument = {
        id: `${Date.now()}`,
        uri: asset.uri,
        title: 'Minha nova página',
        paths: [],
        createdAt: Date.now(),
      };
      setActiveDocument(newDocument);
    } catch (error) {
      Alert.alert('Não foi possível abrir a galeria', 'Tente novamente em alguns instantes.');
    }
  };

  const saveDocument = (document) => {
    setDocuments((previous) => {
      const exists = previous.some((item) => item.id === document.id);
      return exists ? previous.map((item) => item.id === document.id ? document : item) : [document, ...previous];
    });
    setActiveDocument(null);
  };

  if (activeDocument) {
    return <EditorScreen key={activeDocument.id} document={activeDocument} onSave={saveDocument} />;
  }

  return (
    <HomeScreen
      documents={documents}
      onImport={importImage}
      onOpen={(document) => setActiveDocument(document)}
    />
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.paper },
  homeContent: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 34 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 34 },
  brand: { color: COLORS.ink, fontSize: 38, lineHeight: 44, fontFamily: 'serif', fontStyle: 'italic', letterSpacing: -1.8 },
  headerSubtitle: { color: COLORS.muted, fontSize: 11, letterSpacing: 1.1, marginTop: -2 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.greenLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D7E3D8' },
  avatarText: { color: COLORS.green, fontFamily: 'serif', fontSize: 21, fontStyle: 'italic' },
  welcomeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 },
  eyebrow: { color: COLORS.green, fontSize: 9, letterSpacing: 1.7, fontWeight: '800', marginBottom: 9 },
  welcomeTitle: { color: COLORS.ink, fontSize: 27, lineHeight: 32, fontFamily: 'serif', letterSpacing: -0.5 },
  sparkle: { color: COLORS.orange, fontSize: 33, marginBottom: 5 },
  heroCard: { backgroundColor: COLORS.ink, borderRadius: 25, padding: 22, minHeight: 280, overflow: 'hidden', marginBottom: 32 },
  heroTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroTag: { borderColor: '#698173', borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  heroTagText: { color: '#D9E5D9', fontSize: 8, letterSpacing: 1.4, fontWeight: '700' },
  heroArrow: { color: '#DDE8DE', fontSize: 23 },
  heroIllustration: { position: 'absolute', right: 24, top: 49, width: 116, height: 120 },
  paperBack: { position: 'absolute', width: 76, height: 103, backgroundColor: '#B7C9B9', borderRadius: 7, right: 5, top: 4, transform: [{ rotate: '10deg' }] },
  paperFront: { position: 'absolute', width: 76, height: 103, backgroundColor: '#F7F5EB', borderRadius: 7, right: 20, top: 8, padding: 12, transform: [{ rotate: '-7deg' }] },
  paperLineLong: { height: 3, width: 47, backgroundColor: '#B7C4B6', borderRadius: 3, marginBottom: 7 },
  paperLineShort: { height: 3, width: 31, backgroundColor: '#D1D7CE', borderRadius: 3, marginBottom: 12 },
  paperCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D36F5F', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  paperCheck: { fontSize: 12, color: '#D36F5F', fontWeight: '800' },
  paperLineMedium: { height: 3, width: 40, backgroundColor: '#B7C4B6', borderRadius: 3 },
  pencil: { position: 'absolute', right: 1, bottom: 8, width: 35, height: 35, borderRadius: 18, backgroundColor: '#D9A76A', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-20deg' }] },
  pencilText: { color: '#4A3827', fontSize: 21 },
  heroTitle: { color: '#FFFFFF', fontFamily: 'serif', fontSize: 28, lineHeight: 31, marginTop: 116, letterSpacing: -0.4 },
  heroDescription: { color: '#C1CEC3', fontSize: 11, lineHeight: 17, marginTop: 7, maxWidth: 235 },
  heroButton: { alignSelf: 'flex-start', backgroundColor: '#E7EDE4', borderRadius: 13, paddingHorizontal: 16, paddingVertical: 12, marginTop: 16 },
  heroButtonText: { color: COLORS.ink, fontWeight: '700', fontSize: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle: { color: COLORS.ink, fontFamily: 'serif', fontSize: 23 },
  sectionSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  documentCount: { color: '#A0A99F', fontSize: 12, letterSpacing: 1 },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 19, borderWidth: 1, borderColor: COLORS.line, padding: 22, alignItems: 'center' },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: COLORS.greenLight, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: COLORS.ink, fontFamily: 'serif', fontSize: 17, marginBottom: 5 },
  emptyText: { color: COLORS.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', maxWidth: 245 },
  documentList: { gap: 10 },
  documentCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 17, borderWidth: 1, borderColor: COLORS.line, padding: 10 },
  documentThumb: { width: 54, height: 58, backgroundColor: '#F1F0E9', borderRadius: 10, overflow: 'hidden' },
  documentThumbImage: { width: '100%', height: '100%' },
  thumbBadge: { position: 'absolute', right: 3, bottom: 3, width: 19, height: 19, borderRadius: 10, backgroundColor: COLORS.ink, alignItems: 'center', justifyContent: 'center' },
  thumbBadgeText: { color: 'white', fontSize: 11 },
  documentInfo: { flex: 1, marginLeft: 12 },
  documentName: { color: COLORS.ink, fontWeight: '700', fontSize: 13 },
  documentMeta: { color: COLORS.muted, fontSize: 10, marginTop: 5 },
  documentArrow: { color: '#A4ADA4', fontSize: 25, paddingHorizontal: 8 },
  footerNote: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 26, gap: 8 },
  footerLeaf: { color: COLORS.green, fontSize: 13 },
  footerText: { color: '#9AA298', fontSize: 10, letterSpacing: 0.2 },
  editorSafe: { flex: 1, backgroundColor: COLORS.paper },
  editorHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  backButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#ECEFE8', alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.ink, fontSize: 31, lineHeight: 34, marginTop: -4 },
  editorTitleWrap: { flex: 1, marginLeft: 11 },
  editorTitle: { color: COLORS.ink, fontWeight: '700', fontSize: 14 },
  editorSubtitle: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  saveButton: { backgroundColor: COLORS.ink, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  saveButtonText: { color: 'white', fontWeight: '700', fontSize: 11 },
  editorToolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: COLORS.line },
  toolButton: { alignItems: 'center', justifyContent: 'center', minWidth: 48, paddingHorizontal: 4 },
  toolDisabled: { opacity: 0.3 },
  toolGlyph: { color: COLORS.ink, fontSize: 20, lineHeight: 23 },
  toolLabel: { color: '#68756C', fontSize: 8, marginTop: 2 },
  toolbarDivider: { width: 1, height: 29, backgroundColor: COLORS.line, marginHorizontal: 8 },
  editorSpacer: { flex: 1 },
  pageCounter: { backgroundColor: COLORS.greenLight, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  pageCounterText: { color: COLORS.green, fontSize: 9, fontWeight: '700' },
  canvasArea: { flex: 1, paddingHorizontal: 13, paddingTop: 14, paddingBottom: 8 },
  canvasPaper: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 10, overflow: 'hidden', elevation: 2, shadowColor: '#23392E', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  examImage: { width: '100%', height: '100%' },
  canvasHint: { alignItems: 'center', paddingTop: 8 },
  canvasHintText: { color: '#9AA298', fontSize: 10 },
  drawingPanel: { backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 13, borderTopWidth: 1, borderTopColor: COLORS.line },
  toolModeRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10 },
  modeButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 11, marginRight: 7 },
  modeButtonActive: { backgroundColor: COLORS.greenLight },
  modeGlyph: { color: '#7F8B81', fontSize: 17, marginRight: 6 },
  modeGlyphActive: { color: COLORS.green },
  modeText: { color: '#758077', fontSize: 10, fontWeight: '600' },
  modeTextActive: { color: COLORS.green },
  panelDivider: { width: 1, height: 25, backgroundColor: COLORS.line, marginHorizontal: 8 },
  widthOptions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  widthButton: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  widthButtonActive: { borderColor: '#B8CDBB', backgroundColor: '#F4F7F2' },
  widthDot: { borderRadius: 10, backgroundColor: COLORS.ink },
  colorRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F0F1EC', paddingTop: 9 },
  colorLabel: { color: '#9AA298', fontSize: 8, letterSpacing: 1.1, fontWeight: '800', marginRight: 12 },
  colorButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 5, borderWidth: 1, borderColor: 'transparent' },
  colorButtonSelected: { borderColor: '#A7BDAA' },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  panelSpacer: { flex: 1 },
  annotationCount: { color: '#9AA298', fontSize: 9 },
});
