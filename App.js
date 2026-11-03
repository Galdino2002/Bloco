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
import Svg, { Path, Rect } from 'react-native-svg';
import ExamMode from './ExamMode';
import RedacaoMode from './RedacaoMode';

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
const HIGHLIGHTER_COLOR = '#F4D35E';

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
function isInsideLasso(point, polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if(((a.y>point.y)!==(b.y>point.y)) && point.x<((b.x-a.x)*(point.y-a.y))/((b.y-a.y)||0.00001)+a.x) inside=!inside;
  }
  return inside;
}
function getStrokeBounds(strokes) {
  const points=strokes.flatMap(stroke=>stroke.points||[]);
  if(!points.length)return null;
  return {minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y))};
}
function resizeStrokes(strokes,ids,factor) {
  const box=getStrokeBounds(strokes.filter(stroke=>ids.includes(stroke.id)));
  if(!box)return strokes;
  const cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2;
  return strokes.map(stroke=>ids.includes(stroke.id)?{...stroke,width:stroke.width*factor,points:stroke.points.map(p=>({x:cx+(p.x-cx)*factor,y:cy+(p.y-cy)*factor}))}:stroke);
}
function rotateStrokes(strokes,ids,angle) {
  const box=getStrokeBounds(strokes.filter(stroke=>ids.includes(stroke.id)));
  if(!box)return strokes;
  const cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2;
  return strokes.map(stroke=>ids.includes(stroke.id)?{...stroke,points:stroke.points.map(p=>{const x=p.x-cx,y=p.y-cy;return{x:cx+x*Math.cos(angle)-y*Math.sin(angle),y:cy+x*Math.sin(angle)+y*Math.cos(angle)}})}:stroke);
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

function HomeScreen({ documents, onImport, onOpen, onDelete, onExam, onRedacao }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.paper} />
      <ScrollView contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View><Text style={styles.brand}>Bloco</Text><Text style={styles.headerSubtitle}>seu caderno digital</Text></View>
          <View style={styles.avatar}><Text style={styles.avatarText}>B</Text></View>
        </View>
        <View style={styles.welcomeRow}>
          <View><Text style={styles.eyebrow}>SEU CANTINHO DE ESTUDOS</Text><Text style={styles.welcomeTitle}>Sua prova, suas anotações.</Text></View>
          <Text style={styles.sparkle}>✳</Text>
        </View>
        <View style={styles.heroCard}>
          <View style={styles.heroTopLine}><View style={styles.heroTag}><Text style={styles.heroTagText}>NOVO CADERNO</Text></View><Text style={styles.heroArrow}>↗</Text></View>
          <View style={styles.heroIllustration}>
            <View style={styles.paperBack} /><View style={styles.paperFront}><View style={styles.paperLineLong} /><View style={styles.paperLineShort} /><View style={styles.paperCircle}><Text style={styles.paperCheck}>✓</Text></View><View style={styles.paperLineMedium} /></View>
            <View style={styles.pencil}><Text style={styles.pencilText}>✎</Text></View>
          </View>
          <Text style={styles.heroTitle}>Importe as páginas{ '\n' }e resolva aqui.</Text>
          <Text style={styles.heroDescription}>Selecione várias imagens da prova. Depois, escreva, marque e desenhe diretamente sobre cada página.</Text>
          <View style={styles.heroActions}><Pressable onPress={onImport} style={styles.heroButton}><Text style={styles.heroButtonText}>＋  Importar páginas</Text></Pressable><View style={styles.heroSecondaryActions}><Pressable onPress={onExam} style={styles.heroExamButton}><Text style={styles.heroExamButtonText}>Ambiente de provas</Text></Pressable><Pressable onPress={onRedacao} style={styles.heroRedacaoButton}><Text style={styles.heroExamButtonText}>Ambiente de redação</Text></Pressable></View></View>
        </View>
        <View style={styles.sectionHeading}>
          <View><Text style={styles.sectionTitle}>Meus cadernos</Text><Text style={styles.sectionSubtitle}>Continue de onde parou</Text></View>
          <Text style={styles.documentCount}>{documents.length.toString().padStart(2, '0')}</Text>
        </View>
        {documents.length === 0 ? (
          <View style={styles.emptyCard}><View style={styles.emptyIcon}><Text style={{ fontSize: 22 }}>▤</Text></View><Text style={styles.emptyTitle}>Nenhum caderno por enquanto</Text><Text style={styles.emptyText}>Importe as páginas da sua prova em imagens PNG ou JPG para começar a resolver.</Text></View>
        ) : (
          <View style={styles.documentList}>
            {documents.map((document) => {
              const pageCount = document.pages?.length || 1;
              const annotationCount = (document.pages || [{ paths: document.paths || [] }]).reduce((sum, page) => sum + (page.paths?.length || 0), 0);
              return <View key={document.id} style={styles.documentCard}>
                <Pressable onPress={() => onOpen(document)} style={({ pressed }) => [styles.documentOpenArea, pressed && { opacity: 0.75 }]}>
                  <View style={styles.documentThumb}><Image source={{ uri: document.pages?.[0]?.uri || document.uri }} style={styles.documentThumbImage} /><View style={styles.thumbBadge}><Text style={styles.thumbBadgeText}>✎</Text></View></View>
                  <View style={styles.documentInfo}><Text style={styles.documentName} numberOfLines={1}>{document.title || 'Minha prova'}</Text><Text style={styles.documentMeta}>{pageCount} {pageCount === 1 ? 'página' : 'páginas'} · {annotationCount} traços</Text></View>
                  <Text style={styles.documentArrow}>›</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => Alert.alert('Excluir caderno?', 'Todas as páginas e anotações serão removidas.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Excluir', style: 'destructive', onPress: () => onDelete(document.id) }])} style={styles.deleteButton}><Text style={styles.deleteButtonText}>Excluir</Text></Pressable>
              </View>;
            })}
          </View>
        )}
        <View style={styles.footerNote}><Text style={styles.footerLeaf}>✳</Text><Text style={styles.footerText}>Um espaço simples. Para ideias grandes.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

function EditorScreen({ document, onSave }) {
  const initialPages = document.pages?.length ? document.pages : [{ id: 'page-1', uri: document.uri, paths: document.paths || [] }];
  const [pages, setPages] = useState(initialPages);
  const [pageIndex, setPageIndex] = useState(0);
  const [paths, setPaths] = useState(initialPages[0]?.paths || []);
  const [redoPaths, setRedoPaths] = useState([]);
  const [tool, setTool] = useState('pen');
  const [selectedStrokeIds, setSelectedStrokeIds] = useState([]);
  const [selectedClipboard, setSelectedClipboard] = useState([]);
  const [lassoPoints, setLassoPoints] = useState([]);
  const [color, setColor] = useState(PALETTE[0]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const moveStart = useRef({ x: 0, y: 0 });
  const panOffsetRef = useRef(panOffset);
  panOffsetRef.current = panOffset;
  const activePath = useRef(null);
  const pathsRef = useRef(paths);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const widthRef = useRef(strokeWidth);
  const selectedIdsRef = useRef([]);
  const lassoRef = useRef([]);
  const selectionGestureRef = useRef(null);
  pathsRef.current = paths; toolRef.current = tool; colorRef.current = color; widthRef.current = strokeWidth;
  selectedIdsRef.current=selectedStrokeIds; lassoRef.current=lassoPoints;

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      if (toolRef.current === 'select') {
        activePath.current=null;
        const point={x:event.nativeEvent.locationX,y:event.nativeEvent.locationY};
        if(selectedIdsRef.current.length){
          const box=getStrokeBounds(pathsRef.current.filter(stroke=>selectedIdsRef.current.includes(stroke.id)));
          const center=box?{x:(box.minX+box.maxX)/2,y:(box.minY+box.maxY)/2}:point;
          const handle=box?{x:box.maxX+7,y:box.maxY+7}:point;
          if(box&&Math.hypot(point.x-handle.x,point.y-handle.y)<28)selectionGestureRef.current={type:'resize',startDistance:Math.max(1,Math.hypot(handle.x-center.x,handle.y-center.y)),original:pathsRef.current,factor:1};
          else selectionGestureRef.current={type:'move',start:point,original:pathsRef.current};
        }else{selectionGestureRef.current={type:'lasso'};lassoRef.current=[point];setLassoPoints([point]);}
        return;
      }
      if (toolRef.current === 'move') { moveStart.current = { x: panOffsetRef.current.x, y: panOffsetRef.current.y }; return; }
      const point = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
      if (toolRef.current === 'eraser') {
        const next = pathsRef.current.filter((path) => {
          if (path.points.length === 1) return Math.hypot(path.points[0].x - point.x, path.points[0].y - point.y) > 22;
          for (let i = 1; i < path.points.length; i += 1) if (distanceToSegment(point, path.points[i - 1], path.points[i]) < 22) return false;
          return true;
        });
        pathsRef.current = next; setPaths(next); setRedoPaths([]); return;
      }
      const highlighter = toolRef.current === 'highlighter';
      const nextPath = { id: `${Date.now()}-${Math.random()}`, points: [point], color: highlighter ? HIGHLIGHTER_COLOR : colorRef.current, width: highlighter ? 16 : widthRef.current, opacity: highlighter ? 0.42 : 1 };
      activePath.current = nextPath; setPaths((previous) => [...previous, nextPath]); setRedoPaths([]);
    },
    onPanResponderMove: (event, gestureState) => {
      if(toolRef.current==='select' && selectionGestureRef.current?.type==='lasso'){
        const point={x:event.nativeEvent.locationX,y:event.nativeEvent.locationY};
        const next=[...lassoRef.current,point];lassoRef.current=next;setLassoPoints(next);return;
      }
      if(toolRef.current==='select' && selectionGestureRef.current?.type==='resize'){
        const point={x:event.nativeEvent.locationX,y:event.nativeEvent.locationY};
        const box=getStrokeBounds(selectionGestureRef.current.original.filter(stroke=>selectedIdsRef.current.includes(stroke.id)));
        if(!box)return;
        const cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2;
        const factor=Math.max(0.25,Math.min(4,Math.hypot(point.x-cx,point.y-cy)/selectionGestureRef.current.startDistance));
        selectionGestureRef.current.factor=factor;
        const resized=resizeStrokes(selectionGestureRef.current.original,selectedIdsRef.current,factor);
        pathsRef.current=resized;setPaths(resized);return;
      }
      if(toolRef.current==='select' && selectionGestureRef.current?.type==='move'){
        const point={x:event.nativeEvent.locationX,y:event.nativeEvent.locationY};
        const dx=point.x-selectionGestureRef.current.start.x,dy=point.y-selectionGestureRef.current.start.y;
        const moved=selectionGestureRef.current.original.map(stroke=>selectedIdsRef.current.includes(stroke.id)?{...stroke,points:stroke.points.map(p=>({x:p.x+dx,y:p.y+dy}))}:stroke);
        pathsRef.current=moved;setPaths(moved);return;
      }
      if (toolRef.current === 'move') {
        const next = { x: moveStart.current.x + gestureState.dx, y: moveStart.current.y + gestureState.dy };
        panOffsetRef.current = next; setPanOffset(next); return;
      }
      const point = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
      if (toolRef.current === 'eraser') {
        const next = pathsRef.current.filter((path) => !path.points.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < 22));
        if (next.length !== pathsRef.current.length) { pathsRef.current = next; setPaths(next); }
        return;
      }
      if (!activePath.current) return;
      const updated = { ...activePath.current, points: [...activePath.current.points, point] };
      activePath.current = updated; setPaths((previous) => [...previous.slice(0, -1), updated]);
    },
    onPanResponderRelease: (event) => {
      if(toolRef.current==='select' && selectionGestureRef.current?.type==='lasso'){
        const polygon=lassoRef.current;
        const ids=polygon.length>=3?pathsRef.current.filter(stroke=>(stroke.points||[]).some(point=>isInsideLasso(point,polygon))).map(stroke=>stroke.id):[];
        selectedIdsRef.current=ids;setSelectedStrokeIds(ids);lassoRef.current=[];setLassoPoints([]);
      }else if(toolRef.current==='select' && selectionGestureRef.current?.type==='resize'){
        const resized=resizeStrokes(selectionGestureRef.current.original,selectedIdsRef.current,selectionGestureRef.current.factor||1);
        pathsRef.current=resized;setPaths(resized);setRedoPaths([]);
      }else if(toolRef.current==='select' && selectionGestureRef.current?.type==='move'){
        const point={x:event.nativeEvent.locationX,y:event.nativeEvent.locationY};
        const dx=point.x-selectionGestureRef.current.start.x,dy=point.y-selectionGestureRef.current.start.y;
        const moved=selectionGestureRef.current.original.map(stroke=>selectedIdsRef.current.includes(stroke.id)?{...stroke,points:stroke.points.map(p=>({x:p.x+dx,y:p.y+dy}))}:stroke);
        pathsRef.current=moved;setPaths(moved);setRedoPaths([]);
      }
      selectionGestureRef.current=null;activePath.current=null;
    },
    onPanResponderTerminate: () => { activePath.current = null; selectionGestureRef.current=null;lassoRef.current=[];setLassoPoints([]); },
  }), []);

  const changePage = (nextIndex) => {
    if (nextIndex < 0 || nextIndex >= pages.length) return;
    setPages((previous) => previous.map((page, index) => index === pageIndex ? { ...page, paths } : page));
    const nextPage = pages[nextIndex];
    setPageIndex(nextIndex); setPaths(nextPage.paths || []); setRedoPaths([]); setSelectedStrokeIds([]); setLassoPoints([]);
    pathsRef.current = nextPage.paths || [];
    setZoom(1); setPanOffset({ x: 0, y: 0 });
  };
  const undo = () => { if (!paths.length) return; setRedoPaths((previous) => [...previous, paths[paths.length - 1]]); setPaths((previous) => previous.slice(0, -1)); };
  const redo = () => { if (!redoPaths.length) return; setPaths((previous) => [...previous, redoPaths[redoPaths.length - 1]]); setRedoPaths((previous) => previous.slice(0, -1)); };
  const save = () => {
    const updatedPages = pages.map((page, index) => index === pageIndex ? { ...page, paths } : page);
    onSave({ ...document, pages: updatedPages, uri: updatedPages[0]?.uri, paths: updatedPages[0]?.paths || [], updatedAt: Date.now() });
  };
  const currentPage = pages[pageIndex];

  return (
    <SafeAreaView style={styles.editorSafe}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.paper} />
      <View style={styles.editorHeader}>
        <Pressable onPress={save} style={styles.backButton}><Text style={styles.backArrow}>‹</Text></Pressable>
        <View style={styles.editorTitleWrap}><Text style={styles.editorTitle}>{document.title || 'Resolvendo prova'}</Text><Text style={styles.editorSubtitle}>Desenhe diretamente sobre a página</Text></View>
        <Pressable onPress={save} style={styles.saveButton}><Text style={styles.saveButtonText}>Salvar</Text></Pressable>
      </View>
      <View style={styles.editorToolbar}>
        <Pressable onPress={undo} disabled={!paths.length} style={[styles.toolButton, !paths.length && styles.toolDisabled]}><Text style={styles.toolGlyph}>↶</Text><Text style={styles.toolLabel}>Desfazer</Text></Pressable>
        <Pressable onPress={redo} disabled={!redoPaths.length} style={[styles.toolButton, !redoPaths.length && styles.toolDisabled]}><Text style={styles.toolGlyph}>↷</Text><Text style={styles.toolLabel}>Refazer</Text></Pressable>
        <View style={styles.toolbarDivider} />
        <Pressable onPress={() => { setPaths([]); setRedoPaths([]); setSelectedStrokeIds([]); }} style={styles.toolButton}><Text style={styles.toolGlyph}>⌫</Text><Text style={styles.toolLabel}>Limpar</Text></Pressable>
        <View style={styles.editorSpacer} />
        <View style={styles.pageCounter}><Text style={styles.pageCounterText}>{String(pageIndex + 1).padStart(2, '0')} / {String(pages.length).padStart(2, '0')}</Text></View>
      </View>
      <View style={styles.canvasArea}>
        <View style={styles.canvasPaper} onLayout={(event) => setCanvasSize(event.nativeEvent.layout)}>
          <View style={[styles.zoomContent, { transform: [{ translateX: panOffset.x }, { translateY: panOffset.y }, { scale: zoom }] }]}>
            <Image source={{ uri: currentPage.uri }} style={styles.examImage} resizeMode="contain" />
            <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
              <Svg width={canvasSize.width} height={canvasSize.height}>
                {paths.map((path) => <Path key={path.id} d={pathToSvg(path.points)} stroke={path.color} strokeWidth={path.width} strokeOpacity={path.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}{lassoPoints.length>1&&<Path d={pathToSvg(lassoPoints)} stroke={COLORS.green} strokeWidth={2} strokeDasharray="6 4" fill="none"/>}{selectedStrokeIds.length>0&&(()=>{const b=getStrokeBounds(paths.filter(path=>selectedStrokeIds.includes(path.id)));return b?<><Rect x={b.minX-7} y={b.minY-7} width={Math.max(20,b.maxX-b.minX+14)} height={Math.max(20,b.maxY-b.minY+14)} stroke={COLORS.green} strokeWidth={1.5} strokeDasharray="5 4" fill="none"/><Rect x={b.maxX+1} y={b.maxY+1} width={12} height={12} rx={3} fill={COLORS.green}/></>:null;})()}
              </Svg>
            </View>
          </View>
        </View>
        <View style={styles.canvasHintRow}>
          <Text style={styles.canvasHintText}>{tool==='select'?(selectedStrokeIds.length?'Arraste a seleção para mover':'Contorne a escrita para selecionar'):tool === 'move' ? '✥ Arraste para posicionar a folha' : '✎ Desenhe com o dedo sobre a folha'}</Text>
          <View style={styles.zoomControls}>
            <Pressable onPress={() => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))))} style={styles.zoomButton}><Text style={styles.zoomButtonText}>−</Text></Pressable>
            <Text style={styles.zoomValue}>{Math.round(zoom * 100)}%</Text>
            <Pressable onPress={() => setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))} style={styles.zoomButton}><Text style={styles.zoomButtonText}>＋</Text></Pressable>
            <Pressable onPress={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }} style={styles.zoomReset}><Text style={styles.zoomResetText}>Ajustar</Text></Pressable>
          </View>
        </View>
      </View>
      <View style={styles.pageNavigation}>
        <Pressable disabled={pageIndex === 0} onPress={() => changePage(pageIndex - 1)} style={[styles.pageNavButton, pageIndex === 0 && styles.toolDisabled]}><Text style={styles.pageNavText}>‹ Anterior</Text></Pressable>
        <Text style={styles.pageNavLabel}>Página {pageIndex + 1} de {pages.length}</Text>
        <Pressable disabled={pageIndex === pages.length - 1} onPress={() => changePage(pageIndex + 1)} style={[styles.pageNavButton, pageIndex === pages.length - 1 && styles.toolDisabled]}><Text style={styles.pageNavText}>Próxima ›</Text></Pressable>
      </View>
      <View style={styles.drawingPanel}>
        <View style={styles.toolModeRow}>
          <Pressable onPress={() => setTool('pen')} style={[styles.modeButton, tool === 'pen' && styles.modeButtonActive]}><Text style={[styles.modeGlyph, tool === 'pen' && styles.modeGlyphActive]}>✎</Text><Text style={[styles.modeText, tool === 'pen' && styles.modeTextActive]}>Caneta</Text></Pressable>
          <Pressable onPress={() => setTool('highlighter')} style={[styles.modeButton, tool === 'highlighter' && styles.modeButtonActive]}><Text style={[styles.modeGlyph, tool === 'highlighter' && styles.modeGlyphActive]}>▰</Text><Text style={[styles.modeText, tool === 'highlighter' && styles.modeTextActive]}>Marca-texto</Text></Pressable>
          <Pressable onPress={() => {setTool('select');setSelectedStrokeIds([]);}} style={[styles.modeButton, tool === 'select' && styles.modeButtonActive]}><Text style={[styles.modeGlyph, tool === 'select' && styles.modeGlyphActive]}>⌁</Text><Text style={[styles.modeText, tool === 'select' && styles.modeTextActive]}>Laço</Text></Pressable><Pressable onPress={() => setTool('move')} style={[styles.modeButton, tool === 'move' && styles.modeButtonActive]}><Text style={[styles.modeGlyph, tool === 'move' && styles.modeGlyphActive]}>✥</Text><Text style={[styles.modeText, tool === 'move' && styles.modeTextActive]}>Mover folha</Text></Pressable>
          <Pressable onPress={() => setTool('eraser')} style={[styles.modeButton, tool === 'eraser' && styles.modeButtonActive]}><Text style={[styles.modeGlyph, tool === 'eraser' && styles.modeGlyphActive]}>▱</Text><Text style={[styles.modeText, tool === 'eraser' && styles.modeTextActive]}>Borracha</Text></Pressable>
          <View style={styles.panelDivider} />
          <View style={styles.widthOptions}>{[2, 4, 7].map((width) => <Pressable key={width} onPress={() => { setStrokeWidth(width); setTool('pen'); }} style={[styles.widthButton, strokeWidth === width && tool === 'pen' && styles.widthButtonActive]}><View style={[styles.widthDot, { width: width + 3, height: width + 3 }]} /></Pressable>)}</View>
        </View>
        {selectedStrokeIds.length>0&&<View style={styles.selectionActionRow}><Pressable onPress={()=>{setPaths(old=>resizeStrokes(old,selectedStrokeIds,1.15));setRedoPaths([]);}}><Text style={styles.selectionActionText}>Aumentar</Text></Pressable><Pressable onPress={()=>{setPaths(old=>resizeStrokes(old,selectedStrokeIds,0.87));setRedoPaths([]);}}><Text style={styles.selectionActionText}>Diminuir</Text></Pressable><Pressable onPress={()=>{setPaths(old=>rotateStrokes(old,selectedStrokeIds,Math.PI/12));setRedoPaths([]);}}><Text style={styles.selectionActionText}>Girar</Text></Pressable><Pressable onPress={()=>{const picked=paths.filter(path=>selectedStrokeIds.includes(path.id));setSelectedClipboard(picked);setPaths(old=>old.filter(path=>!selectedStrokeIds.includes(path.id)));setSelectedStrokeIds([]);setRedoPaths([]);}}><Text style={styles.selectionActionText}>Recortar</Text></Pressable><Pressable onPress={()=>{if(!selectedClipboard.length)return;const pasted=selectedClipboard.map(path=>({...path,id:`${Date.now()}-${Math.random()}`,points:path.points.map(p=>({x:p.x+24,y:p.y+24}))}));setPaths(old=>[...old,...pasted]);setSelectedStrokeIds(pasted.map(path=>path.id));setRedoPaths([]);}}><Text style={styles.selectionActionText}>Colar</Text></Pressable><Pressable onPress={()=>{setPaths(old=>old.filter(path=>!selectedStrokeIds.includes(path.id)));setSelectedStrokeIds([]);setRedoPaths([]);}}><Text style={[styles.selectionActionText,{color:COLORS.rose}]}>Excluir</Text></Pressable><Pressable onPress={()=>setSelectedStrokeIds([])}><Text style={styles.selectionActionText}>Desmarcar</Text></Pressable></View>}<View style={styles.colorRow}><Text style={styles.colorLabel}>COR</Text>{PALETTE.map((item) => <Pressable key={item} onPress={() => { setColor(item); setTool('pen'); }} style={[styles.colorButton, color === item && tool === 'pen' && styles.colorButtonSelected]}><View style={[styles.colorDot, { backgroundColor: item }]} /></Pressable>)}<View style={styles.panelSpacer} /><Text style={styles.annotationCount}>{paths.length} traços nesta página</Text></View>
      </View>
    </SafeAreaView>
  );
}

function BlocoApp() {
  const [documents, setDocuments] = useState([]);
  const [activeDocument, setActiveDocument] = useState(null);
  const [examMode, setExamMode] = useState(false);
  const [redacaoMode, setRedacaoMode] = useState(false);

  const importImages = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 100,
        orderedSelection: true,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;
      const pages = result.assets.map((asset, index) => ({
        id: `page-${index + 1}-${Date.now()}`,
        uri: asset.uri,
        paths: [],
        fileName: asset.fileName || `Página ${index + 1}`,
      }));
      const newDocument = { id: `${Date.now()}`, title: 'Minha prova', pages, createdAt: Date.now() };
      setActiveDocument(newDocument);
    } catch (error) {
      console.error('Erro ao importar páginas:', error);
      Alert.alert('Não foi possível importar as imagens', error?.message || 'Tente selecionar as imagens novamente.');
    }
  };

  const saveDocument = (document) => {
    setDocuments((previous) => {
      const exists = previous.some((item) => item.id === document.id);
      return exists ? previous.map((item) => item.id === document.id ? document : item) : [document, ...previous];
    });
    setActiveDocument(null);
  };
  const deleteDocument = (documentId) => setDocuments((previous) => previous.filter((item) => item.id !== documentId));

  if (activeDocument) return <EditorScreen key={activeDocument.id} document={activeDocument} onSave={saveDocument} />;
  if (examMode) return <ExamMode onExit={() => setExamMode(false)} />;
  if (redacaoMode) return <RedacaoMode onExit={() => setRedacaoMode(false)} />;
  return <HomeScreen documents={documents} onImport={importImages} onOpen={setActiveDocument} onDelete={deleteDocument} onExam={() => setExamMode(true)} onRedacao={() => setRedacaoMode(true)} />;
}

export default function App() {
  return <BlocoApp />;
}

const styles = StyleSheet.create({
  pageNavigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingVertical: 8, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.line },
  pageNavButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: COLORS.greenLight },
  pageNavText: { color: COLORS.green, fontSize: 10, fontWeight: '700' },
  pageNavLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
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
  heroActions: { flexDirection: 'column', alignItems: 'stretch', gap: 9, marginTop: 16 },
  heroSecondaryActions: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  heroButton: { alignSelf: 'flex-start', backgroundColor: '#E7EDE4', borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12 },
  heroButtonText: { color: COLORS.ink, fontWeight: '700', fontSize: 11 },
  heroExamButton: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderColor: '#82978A', borderWidth: 1, borderRadius: 13, paddingHorizontal: 8, paddingVertical: 11 },
  heroRedacaoButton: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#476B5A', borderColor: '#82978A', borderWidth: 1, borderRadius: 13, paddingHorizontal: 8, paddingVertical: 11 },
  heroExamButtonText: { color: '#E7EDE4', fontWeight: '700', fontSize: 11 },
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
  documentOpenArea: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  deleteButton: { paddingHorizontal: 10, paddingVertical: 9, marginLeft: 5, borderRadius: 9, backgroundColor: '#FBEFED' },
  deleteButtonText: { color: COLORS.rose, fontSize: 10, fontWeight: '700' },
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
  zoomContent: { width: '100%', height: '100%' },
  canvasHintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 7 },
  canvasHintText: { color: '#9AA298', fontSize: 9 },
  zoomControls: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  zoomButton: { width: 27, height: 27, borderRadius: 9, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center' },
  zoomButtonText: { color: COLORS.green, fontSize: 18, fontWeight: '600', lineHeight: 22 },
  zoomValue: { color: COLORS.green, fontSize: 9, minWidth: 34, textAlign: 'center', fontWeight: '700' },
  zoomReset: { paddingHorizontal: 7, paddingVertical: 6 },
  zoomResetText: { color: COLORS.muted, fontSize: 9, fontWeight: '600' },
  drawingPanel: { backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 13, borderTopWidth: 1, borderTopColor: COLORS.line },
  toolModeRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10, flexWrap: 'wrap' },
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
  selectionActionRow: { flexDirection:'row', flexWrap:'wrap', gap:14, paddingBottom:9 },
  selectionActionText: { color:COLORS.green, fontSize:10, fontWeight:'700' },
  colorRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F0F1EC', paddingTop: 9 },
  colorLabel: { color: '#9AA298', fontSize: 8, letterSpacing: 1.1, fontWeight: '800', marginRight: 12 },
  colorButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 5, borderWidth: 1, borderColor: 'transparent' },
  colorButtonSelected: { borderColor: '#A7BDAA' },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  panelSpacer: { flex: 1 },
  annotationCount: { color: '#9AA298', fontSize: 9 },
});
