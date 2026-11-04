import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import storage from './storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import ExamMode from './ExamMode';
import RedacaoMode from './RedacaoMode';
import { eraseAtPoint, getHighlighterStyle, pathIntersectsPolygon, screenToDocument } from './drawing';
import { commitHistory, createHistory, redoHistory, undoHistory } from './drawingHistory';
import { ContextToolbar, IconButton, ScreenTitle } from './designSystem';

const { readArrayWithBackup, writeArrayWithBackup } = storage;

const NOTEBOOKS_STORAGE_KEY = '@bloco:notebooks:v1';
const NOTEBOOKS_BACKUP_KEY = '@bloco:notebooks:backup:v1';
const NOTEBOOKS_FILES_DIRECTORY = `${FileSystem.documentDirectory}bloco-notebooks/`;

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

const PALETTE = ['#202124','#5F6368','#B3261E','#E67C73','#E8710A','#F9AB00','#188038','#34A853','#00796B','#12A594','#1A73E8','#4285F4','#3F51B5','#673AB7','#A142F4','#D81B60','#8D6E63','#FFFFFF'];

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function eraseWholeStrokesAtPoint(paths, point, radius) {
  return paths.filter(stroke => {
    const points = stroke.points || [];
    const threshold = radius + (stroke.width || 1) / 2;
    if (points.length <= 1) {
      return !points.length || Math.hypot(points[0].x - point.x, points[0].y - point.y) > threshold;
    }
    for (let index = 1; index < points.length; index += 1) {
      if (distanceToSegment(point, points[index - 1], points[index]) <= threshold) return false;
    }
    return true;
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character]));
}


async function packLocalPageAssets(items) {
  return Promise.all(items.map(async item => {
    const sourcePages = Array.isArray(item.pages) ? item.pages : item.uri ? [{ id: `page-${item.id || 'legacy'}`, uri: item.uri, paths: item.paths || [] }] : null;
    if (!sourcePages) return item;
    const pages = await Promise.all(sourcePages.map(async page => {
      if (!page.uri || !String(page.uri).startsWith('file://')) return page;
      const info = await FileSystem.getInfoAsync(page.uri);
      if (!info.exists) throw new Error(`Não foi possível incluir a imagem da página ${page.fileName || page.id || ''} no backup.`);
      const base64 = await FileSystem.readAsStringAsync(page.uri, { encoding: FileSystem.EncodingType.Base64 });
      const extension = String(page.uri).split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
      return { ...page, backupAssetBase64: base64, backupAssetExtension: extension };
    }));
    return { ...item, pages };
  }));
}

async function restoreLocalPageAssets(items) {
  const directory = `${FileSystem.documentDirectory}bloco-backup-assets/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return Promise.all(items.map(async item => {
    if (!Array.isArray(item.pages)) return item;
    const pages = await Promise.all(item.pages.map(async (page, index) => {
      if (!page.backupAssetBase64) return page;
      const extension = String(page.backupAssetExtension || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
      const uri = `${directory}${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.${extension}`;
      await FileSystem.writeAsStringAsync(uri, page.backupAssetBase64, { encoding: FileSystem.EncodingType.Base64 });
      const { backupAssetBase64, backupAssetExtension, ...cleanPage } = page;
      return { ...cleanPage, uri };
    }));
    return { ...item, pages, uri: pages[0]?.uri || item.uri, paths: pages[0]?.paths || item.paths || [] };
  }));
}

function pathToSvg(points) {
  if (!points.length) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
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

function PageBackground({ type }) {
  if (type === 'plain') return null;
  if (type === 'ruled') {
    return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: 28 }, (_, index) => <View key={index} style={[styles.pageRule, { top: 28 + index * 27 }]} />)}
    </View>;
  }
  if (type === 'grid') {
    return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: 24 }, (_, index) => <View key={`h-${index}`} style={[styles.pageRule, { top: index * 27 }]} />)}
      {Array.from({ length: 16 }, (_, index) => <View key={`v-${index}`} style={[styles.pageGridColumn, { left: index * 27 }]} />)}
    </View>;
  }
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {Array.from({ length: 320 }, (_, index) => <View key={index} style={[styles.pageDot, { left: 10 + (index % 16) * 27, top: 10 + Math.floor(index / 16) * 27 }]} />)}
  </View>;
}

function HomeScreen({ documents, onImport, onExportBackup, onImportBackup, onCreateNote, onOpen, onDelete, onExam, onRedacao, onUpdate, onDuplicate }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('updated');
  const [folderFilter, setFolderFilter] = useState('all');
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderTarget, setFolderTarget] = useState(null);
  const [folderValue, setFolderValue] = useState('');
  const [folderParent, setFolderParent] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const folders = useMemo(() => {
    const paths = new Set();
    documents.filter(item => !item.deletedAt).forEach(item => {
      const fullPath = item.folderPath || item.folderName;
      if (!fullPath) return;
      const segments = fullPath.split('/').map(part => part.trim()).filter(Boolean);
      let current = '';
      segments.forEach(segment => { current = current ? `${current}/${segment}` : segment; paths.add(current); });
    });
    return [...paths].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [documents]);
  const filteredDocuments = useMemo(() => documents
    .filter(document => filter === 'trash' ? document.deletedAt : !document.deletedAt)
    .filter(document => filter === 'favorite' ? document.favorite && !document.deletedAt : true)
    .filter(document => {
      const path = document.folderPath || document.folderName || '';
      return folderFilter === 'all' ? true : folderFilter === 'unfiled' ? !path : path === folderFilter || path.startsWith(`${folderFilter}/`);
    })
    .filter(document => {
      const normalized = query.trim().toLocaleLowerCase();
      const pageText = (document.pages || []).map(page => page.text || '').join(' ');
      return !normalized || `${document.title || ''} ${pageText}`.toLocaleLowerCase().includes(normalized);
    })
    .sort((a, b) => sort === 'name'
      ? (a.title || '').localeCompare(b.title || '', 'pt-BR')
      : sort === 'created'
        ? (b.createdAt || 0) - (a.createdAt || 0)
        : (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)), [documents, filter, folderFilter, query, sort]);
  const saveRename = () => {
    const title = renameValue.trim();
    if (!title || !renameTarget) return;
    onUpdate({ ...renameTarget, title, updatedAt: Date.now() });
    setRenameTarget(null);
  };
  const toggleSelected = id => setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const moveSelected = folder => {
    documents.filter(item => selectedIds.includes(item.id)).forEach(item => {
      const normalizedPath = typeof folder === 'string' ? folder.split('/').map(part => part.trim()).filter(Boolean).join('/') : '';
      const segments = normalizedPath.split('/').filter(Boolean);
      onUpdate({ ...item, folderPath: normalizedPath || null, folderName: segments.length ? segments[segments.length - 1] : null, updatedAt: Date.now() });
    });
    setSelectedIds([]); setSelectionMode(false); setFolderTarget(null); setFolderValue(''); setFolderParent('');
  };
  const openFolderManager = document => {
    setSelectedIds(document ? [document.id] : []);
    setSelectionMode(true);
    setFolderTarget(document || { id: '__bulk__' });
    setFolderValue('');
    setFolderParent('');
  };
  const selectedCount = selectedIds.length;
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.paper} />
      <ScrollView contentContainerStyle={styles.homeContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenTitle eyebrow="BLOCO · ESTUDOS E IDEIAS" title="Seu espaço de foco" subtitle="Tudo o que você estuda, em um só lugar" right={<View style={{ flexDirection: 'row', gap: 7 }}><IconButton label="⇧" accessibilityLabel="Exportar backup" onPress={onExportBackup} /><IconButton label="⇩" accessibilityLabel="Restaurar backup" onPress={onImportBackup} /><IconButton label="▧" accessibilityLabel="Importar páginas da galeria" onPress={onImport} /></View>} />
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput value={query} onChangeText={setQuery} placeholder="Buscar cadernos e conteúdo" placeholderTextColor={COLORS.muted} style={styles.searchInput} returnKeyType="search" />
          {!!query && <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Limpar busca"><Text style={styles.searchClear}>×</Text></Pressable>}
        </View>
        <View style={styles.quickLaunchPanel}>
          <View style={styles.quickLaunchHeader}><Text style={styles.quickLaunchTitle}>Criar</Text><Text style={styles.quickLaunchSubtitle}>Escolha como deseja começar</Text></View>
          <View style={styles.quickLaunchRow}>
            <Pressable onPress={onCreateNote} style={styles.quickLaunchCard} accessibilityRole="button"><Text style={styles.quickLaunchIcon}>＋</Text><Text style={styles.quickLaunchCardTitle}>Nota</Text><Text style={styles.quickLaunchCardText}>Anotar livremente</Text></Pressable>
            <Pressable onPress={onExam} style={styles.quickLaunchCard} accessibilityRole="button"><Text style={styles.quickLaunchIcon}>◷</Text><Text style={styles.quickLaunchCardTitle}>Prova</Text><Text style={styles.quickLaunchCardText}>Resolver questões</Text></Pressable>
            <Pressable onPress={onRedacao} style={styles.quickLaunchCard} accessibilityRole="button"><Text style={styles.quickLaunchIcon}>✎</Text><Text style={styles.quickLaunchCardTitle}>Redação</Text><Text style={styles.quickLaunchCardText}>Escrever e revisar</Text></Pressable>
          </View>
        </View>
        <View style={styles.sectionHeading}>
          <View><Text style={styles.sectionTitle}>{filter === 'trash' ? 'Lixeira' : filter === 'favorite' ? 'Favoritos' : folderFilter !== 'all' ? folderFilter === 'unfiled' ? 'Sem pasta' : folderFilter : 'Seus documentos'}</Text><Text style={styles.sectionSubtitle}>{filteredDocuments.length} {filteredDocuments.length === 1 ? 'documento' : 'documentos'} · organizado para continuar</Text></View>
          <Pressable onPress={() => { setSelectionMode(value => !value); setSelectedIds([]); }} style={styles.organizeButton}><Text style={styles.organizeButtonText}>{selectionMode ? 'Concluir' : 'Selecionar'}</Text></Pressable>
        </View>
        <View style={styles.filterRow}>
          <Pressable onPress={() => { setFilter('all'); setFolderFilter('all'); }} style={[styles.filterChip, filter === 'all' && folderFilter === 'all' && styles.filterChipActive]}><Text style={[styles.filterText, filter === 'all' && folderFilter === 'all' && styles.filterTextActive]}>Todos</Text></Pressable>
          <Pressable onPress={() => { setFilter('favorite'); setFolderFilter('all'); }} style={[styles.filterChip, filter === 'favorite' && styles.filterChipActive]}><Text style={[styles.filterText, filter === 'favorite' && styles.filterTextActive]}>★ Favoritos</Text></Pressable>
          <Pressable onPress={() => { setFilter('trash'); setFolderFilter('all'); }} style={[styles.filterChip, filter === 'trash' && styles.filterChipActive]}><Text style={[styles.filterText, filter === 'trash' && styles.filterChipActive && styles.filterTextActive]}>Lixeira</Text></Pressable>
          <Pressable onPress={() => setSort(value => value === 'updated' ? 'name' : value === 'name' ? 'created' : 'updated')} style={styles.sortChip}><Text style={styles.filterText}>{sort === 'updated' ? 'Recentes' : sort === 'name' ? 'Nome' : 'Criação'} ↕</Text></Pressable>
        </View>
        {folders.length > 0 && filter !== 'trash' && <View style={styles.folderSection}>
          <Text style={styles.folderSectionLabel}>PASTAS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderChips}>
            <Pressable onPress={() => { setFilter('all'); setFolderFilter('all'); }} style={[styles.folderChip, folderFilter === 'all' && styles.folderChipActive]}><Text style={[styles.folderChipText, folderFilter === 'all' && styles.folderChipTextActive]}>Tudo</Text></Pressable>
            {folders.map(folder => <Pressable key={folder} onPress={() => { setFilter('all'); setFolderFilter(folder); }} style={[styles.folderChip, folderFilter === folder && styles.folderChipActive]}><Text style={[styles.folderChipText, folderFilter === folder && styles.folderChipTextActive]}>▰ {folder.split('/').map((part, index) => index ? ` › ${part}` : part).join('')}</Text></Pressable>)}
            <Pressable onPress={() => { setFilter('all'); setFolderFilter('unfiled'); }} style={[styles.folderChip, folderFilter === 'unfiled' && styles.folderChipActive]}><Text style={[styles.folderChipText, folderFilter === 'unfiled' && styles.folderChipTextActive]}>Sem pasta</Text></Pressable>
          </ScrollView>
        </View>}
        {selectionMode && <View style={styles.bulkBar}>
          <Text style={styles.bulkBarText}>{selectedCount} selecionado(s)</Text>
          <Pressable disabled={!selectedCount} onPress={() => openFolderManager()} style={[styles.bulkAction, !selectedCount && styles.disabledAction]}><Text style={styles.bulkActionText}>Mover para pasta</Text></Pressable>
          <Pressable disabled={!selectedCount} onPress={() => { selectedIds.forEach(id => onDelete(id)); setSelectedIds([]); setSelectionMode(false); }} style={[styles.bulkAction, styles.bulkDanger, !selectedCount && styles.disabledAction]}><Text style={styles.bulkActionText}>Lixeira</Text></Pressable>
        </View>}
        {filteredDocuments.length === 0 ? (
          <View style={styles.emptyCard}><View style={styles.emptyIcon}><Text style={{ fontSize: 22 }}>▤</Text></View><Text style={styles.emptyTitle}>{query || filter === 'favorite' || folderFilter !== 'all' ? 'Nada por aqui' : filter === 'trash' ? 'Lixeira vazia' : 'Seu espaço começa aqui'}</Text><Text style={styles.emptyText}>{query ? 'Tente buscar por outro termo.' : filter === 'trash' ? 'Os documentos excluídos aparecerão aqui.' : 'Crie uma nota, comece uma prova ou escreva uma redação. Você poderá organizar tudo em pastas.'}</Text></View>
        ) : (
          <View style={styles.documentList}>
            {filteredDocuments.map(document => {
              const pageCount = document.pages?.length || 1;
              const annotationCount = (document.pages || [{ paths: document.paths || [] }]).reduce((sum, page) => sum + (page.paths?.length || 0), 0);
              const selected = selectedIds.includes(document.id);
              return <View key={document.id} style={[styles.documentCard, selected && styles.documentCardSelected]}>
                {selectionMode && <Pressable onPress={() => toggleSelected(document.id)} style={styles.selectionCheck} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}><Text style={styles.selectionCheckText}>{selected ? '✓' : ''}</Text></Pressable>}
                <Pressable onLongPress={() => { if (!selectionMode) { setSelectionMode(true); setSelectedIds([document.id]); } }} onPress={() => selectionMode ? toggleSelected(document.id) : onOpen(document)} style={({ pressed }) => [styles.documentOpenArea, pressed && { opacity: 0.75 }]}>
                  <View style={styles.documentThumb}>{document.pages?.[0]?.uri || document.uri ? <Image source={{ uri: document.pages?.[0]?.uri || document.uri }} style={styles.documentThumbImage} resizeMode="cover" /> : <View style={styles.documentThumbEmpty}><Text style={styles.documentThumbEmptyGlyph}>✎</Text></View>}<View style={styles.thumbBadge}><Text style={styles.thumbBadgeText}>{pageCount}</Text></View></View>
                  <View style={styles.documentInfo}>
                    <Text style={styles.documentName} numberOfLines={1}>{document.title || 'Sem título'}</Text>
                    <Text style={styles.documentMeta}>{pageCount} {pageCount === 1 ? 'página' : 'páginas'} · {annotationCount} anotações</Text>
                    <Text style={styles.documentDate}>{(document.folderPath || document.folderName) ? `▰ ${document.folderPath || document.folderName} · ` : ''}{document.updatedAt ? new Date(document.updatedAt).toLocaleDateString('pt-BR') : 'Ainda não editado'}</Text>
                  </View>
                  {!selectionMode && <Text style={styles.documentArrow}>›</Text>}
                </Pressable>
                {!selectionMode && <Pressable accessibilityRole="button" accessibilityLabel={`Mais opções para ${document.title || 'documento'}`} onPress={() => Alert.alert(document.title || 'Opções', undefined, document.deletedAt ? [
                  { text: 'Restaurar', onPress: () => onUpdate({ ...document, deletedAt: null, updatedAt: Date.now() }) },
                  { text: 'Excluir definitivamente', style: 'destructive', onPress: () => onDelete(document.id, true) },
                  { text: 'Cancelar', style: 'cancel' },
                ] : [
                  { text: document.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos', onPress: () => onUpdate({ ...document, favorite: !document.favorite, updatedAt: Date.now() }) },
                  { text: 'Mover para pasta', onPress: () => openFolderManager(document) },
                  { text: 'Renomear', onPress: () => { setRenameTarget(document); setRenameValue(document.title || ''); } },
                  { text: 'Duplicar', onPress: () => onDuplicate(document) },
                  { text: 'Mover para a lixeira', style: 'destructive', onPress: () => onDelete(document.id) },
                  { text: 'Cancelar', style: 'cancel' },
                ])} style={styles.moreButton}><Text style={styles.moreButtonText}>•••</Text></Pressable>}
              </View>;
            })}
          </View>
        )}
        <View style={styles.footerNote}><Text style={styles.footerLeaf}>✳</Text><Text style={styles.footerText}>Um espaço simples. Para ideias grandes.</Text></View>
      </ScrollView>
      <Modal visible={!!renameTarget} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <View style={styles.modalBackdrop}><View style={styles.renameCard}><Text style={styles.sheetTitle}>Renomear documento</Text><TextInput autoFocus value={renameValue} onChangeText={setRenameValue} style={styles.renameInput} placeholder="Nome do documento" placeholderTextColor={COLORS.muted} onSubmitEditing={saveRename} /><View style={styles.renameActions}><Pressable onPress={() => setRenameTarget(null)} style={styles.renameCancel}><Text style={styles.renameCancelText}>Cancelar</Text></Pressable><Pressable onPress={saveRename} style={styles.renameConfirm}><Text style={styles.renameConfirmText}>Salvar</Text></Pressable></View></View></View>
      </Modal>
      <Modal visible={!!folderTarget} transparent animationType="slide" onRequestClose={() => setFolderTarget(null)}>
        <View style={styles.modalBackdrop}><View style={styles.folderModalCard}><View style={styles.sheetHandle} /><Text style={styles.sheetTitle}>Organizar em pasta</Text><Text style={styles.sheetSubtitle}>{selectedCount || 1} documento(s) selecionado(s)</Text>
          <Text style={styles.folderSectionLabel}>MOVER PARA</Text>
          <ScrollView style={{ maxHeight: 130 }} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => moveSelected(null)} style={styles.folderChoice}><Text style={styles.folderChoiceText}>Sem pasta</Text></Pressable>
            {folders.map(folder => <Pressable key={folder} onPress={() => moveSelected(folder)} style={styles.folderChoice}><Text style={styles.folderChoiceText}>▰ {folder}</Text></Pressable>)}
          </ScrollView>
          <Text style={styles.folderSectionLabel}>CRIAR PASTA OU SUBPASTA</Text>
          <Text style={styles.folderChoiceText}>Criar dentro de: {folderParent || 'Raiz'}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 7 }}>
            <Pressable onPress={() => setFolderParent('')} style={[styles.folderChoice, !folderParent && { backgroundColor: COLORS.greenLight }]}><Text style={styles.folderChoiceText}>Raiz</Text></Pressable>
            {folders.map(folder => <Pressable key={`parent-${folder}`} onPress={() => setFolderParent(folder)} style={[styles.folderChoice, folderParent === folder && { backgroundColor: COLORS.greenLight }]}><Text style={styles.folderChoiceText}>{folder}</Text></Pressable>)}
          </ScrollView>
          <TextInput value={folderValue} onChangeText={setFolderValue} placeholder="Nome da nova pasta" placeholderTextColor={COLORS.muted} style={styles.renameInput} maxLength={40} returnKeyType="done" onSubmitEditing={() => { const name = folderValue.trim().replace(/[\\/]/g, ''); if (name) moveSelected(folderParent ? `${folderParent}/${name}` : name); }} />
          <View style={styles.renameActions}><Pressable onPress={() => { setFolderTarget(null); setFolderParent(''); }} style={styles.renameCancel}><Text style={styles.renameCancelText}>Cancelar</Text></Pressable><Pressable disabled={!folderValue.trim()} onPress={() => { const name = folderValue.trim().replace(/[\\/]/g, ''); if (name) moveSelected(folderParent ? `${folderParent}/${name}` : name); }} style={[styles.renameConfirm, !folderValue.trim() && styles.disabledAction]}><Text style={styles.renameConfirmText}>Criar e mover</Text></Pressable></View>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

function EditorScreen({ document, onSave, onChange }) {
  const initialPages = (document.pages?.length ? document.pages : [{ id: 'page-1', uri: document.uri, paths: document.paths || [] }]).map((page, index) => ({ ...page, id: page.id || `page-${document.id || 'note'}-${index + 1}` }));
  const [title, setTitle] = useState(document.title || 'Minha nota');
  const [saveState, setSaveState] = useState('saved');
  const titleRef = useRef(title);
  titleRef.current = title;
  const [pages, setPages] = useState(initialPages);
  const [pageIndex, setPageIndex] = useState(0);
  const [paths, setPaths] = useState(initialPages[0]?.paths || []);
  const [pageText, setPageText] = useState(initialPages[0]?.text || '');
  const [pageBackground, setPageBackground] = useState(initialPages[0]?.background || 'plain');
  const [, setRedoPaths] = useState([]);
  const [pathHistory, setPathHistory] = useState(() => createHistory({
    paths: initialPages[0]?.paths || [],
    text: initialPages[0]?.text || '',
    background: initialPages[0]?.background || 'plain',
  }));
  const [tool, setTool] = useState('pen');
  const [selectedStrokeIds, setSelectedStrokeIds] = useState([]);
  const [selectedClipboard, setSelectedClipboard] = useState([]);
  const [lassoPoints, setLassoPoints] = useState([]);
  const [color, setColor] = useState(PALETTE[0]);
  const [markerType, setMarkerType] = useState('classic');
  const [markerWidth, setMarkerWidth] = useState(18);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [penOpacity, setPenOpacity] = useState(1);
  const [eraserSize, setEraserSize] = useState(24);
  const [eraserMode, setEraserMode] = useState('partial');
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const canvasSizeRef = useRef(canvasSize);
  const zoomRef = useRef(zoom);
  const pinchStart = useRef(null);
  zoomRef.current = zoom;
  const moveStart = useRef({ x: 0, y: 0 });
  const panOffsetRef = useRef(panOffset);
  panOffsetRef.current = panOffset;
  canvasSizeRef.current = canvasSize;
  const activePath = useRef(null);
  const pathsRef = useRef(paths);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const markerTypeRef = useRef(markerType);
  const markerWidthRef = useRef(markerWidth);
  const widthRef = useRef(strokeWidth);
  const penOpacityRef = useRef(penOpacity);
  const eraserSizeRef = useRef(eraserSize);
  const eraserModeRef = useRef(eraserMode);
  const selectedIdsRef = useRef([]);
  const lassoRef = useRef([]);
  const selectionGestureRef = useRef(null);
  const pathHistoryRef = useRef(pathHistory);
  pathsRef.current = paths; toolRef.current = tool; colorRef.current = color; markerTypeRef.current = markerType; markerWidthRef.current = markerWidth; widthRef.current = strokeWidth; penOpacityRef.current = penOpacity; eraserSizeRef.current = eraserSize; eraserModeRef.current = eraserMode;
  selectedIdsRef.current=selectedStrokeIds; lassoRef.current=lassoPoints;
  pathHistoryRef.current = pathHistory;

  const pageTextRef = useRef(pageText);
  const pageBackgroundRef = useRef(pageBackground);
  pageTextRef.current = pageText;
  pageBackgroundRef.current = pageBackground;

  const currentSnapshot = (overrides = {}) => ({
    paths: pathsRef.current,
    text: pageTextRef.current,
    background: pageBackgroundRef.current,
    ...overrides,
  });
  const applySnapshot = (snapshot) => {
    const nextPaths = snapshot?.paths || [];
    pathsRef.current = nextPaths;
    setPaths(nextPaths);
    setPageText(snapshot?.text || '');
    setPageBackground(snapshot?.background || 'plain');
  };
  const applyPathChange = (nextPaths, record = true) => {
    pathsRef.current = nextPaths;
    setPaths(nextPaths);
    if (record) {
      const nextHistory = commitHistory(pathHistoryRef.current, currentSnapshot({ paths: nextPaths }));
      pathHistoryRef.current = nextHistory;
      setPathHistory(nextHistory);
    }
    setRedoPaths([]);
  };

  const recordPathSnapshot = (overrides = {}) => {
    const nextSnapshot = currentSnapshot(overrides);
    if (JSON.stringify(pathHistoryRef.current.present) === JSON.stringify(nextSnapshot)) return;
    const nextHistory = commitHistory(pathHistoryRef.current, nextSnapshot);
    pathHistoryRef.current = nextHistory;
    setPathHistory(nextHistory);
    setRedoPaths([]);
  };
  const recordPathSnapshotRef = useRef(recordPathSnapshot);
  recordPathSnapshotRef.current = recordPathSnapshot;

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches || [];
      if (touches.length >= 2) {
        activePath.current = null;
        selectionGestureRef.current = null;
        const [first, second] = touches;
        pinchStart.current = {
          distance: Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY),
          zoom: zoomRef.current,
          pan: { ...panOffsetRef.current },
          focal: { x: ((first.locationX ?? 0) + (second.locationX ?? 0)) / 2 - canvasSizeRef.current.width / 2, y: ((first.locationY ?? 0) + (second.locationY ?? 0)) / 2 - canvasSizeRef.current.height / 2 },
        };
        return;
      }
      if (toolRef.current === 'select') {
        activePath.current=null;
        const point=screenToDocument({x:event.nativeEvent.locationX,y:event.nativeEvent.locationY},{zoom: zoomRef.current, pan: panOffsetRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2}});
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
      const point = screenToDocument({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }, { zoom: zoomRef.current, pan: panOffsetRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2} });
      if (toolRef.current === 'eraser') {
        const previous = pathsRef.current;
        const next = eraserModeRef.current === 'whole'
          ? eraseWholeStrokesAtPoint(previous, point, eraserSizeRef.current)
          : eraseAtPoint(previous, point, eraserSizeRef.current);
        const changed = next.length !== previous.length || next.some((path, index) => path !== previous[index]);
        if (changed) {
          pathsRef.current = next;
          setPaths(next);
          setRedoPaths([]);
        }
        return;
      }
      const highlighter = toolRef.current === 'highlighter';
      const marker = markerTypeRef.current;
      const markerStyle = getHighlighterStyle(marker, markerWidthRef.current);
      const nextPath = { id: `${Date.now()}-${Math.random()}`, points: [point], color: colorRef.current, width: highlighter ? markerStyle.width : widthRef.current, opacity: highlighter ? markerStyle.opacity : penOpacityRef.current, kind: highlighter ? 'highlighter' : 'pen' };
      activePath.current = nextPath;
      pathsRef.current = [...pathsRef.current, nextPath];
      setPaths(pathsRef.current);
      setRedoPaths([]);
    },
    onPanResponderMove: (event, gestureState) => {
      const touches = event.nativeEvent.touches || [];
      if (touches.length >= 2) {
        activePath.current = null;
        const [first, second] = touches;
        const distance = Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
        if (!pinchStart.current && distance > 0) {
          pinchStart.current = { distance, zoom: zoomRef.current, pan: { ...panOffsetRef.current }, focal: { x: ((first.locationX ?? 0) + (second.locationX ?? 0)) / 2 - canvasSizeRef.current.width / 2, y: ((first.locationY ?? 0) + (second.locationY ?? 0)) / 2 - canvasSizeRef.current.height / 2 } };
          return;
        }
        if (pinchStart.current?.distance > 0) {
          const nextZoom = Math.min(3, Math.max(0.5, pinchStart.current.zoom * distance / pinchStart.current.distance));
          const focal = { x: ((first.locationX ?? 0) + (second.locationX ?? 0)) / 2 - canvasSizeRef.current.width / 2, y: ((first.locationY ?? 0) + (second.locationY ?? 0)) / 2 - canvasSizeRef.current.height / 2 };
          const nextPan = {
            x: focal.x - ((pinchStart.current.focal.x - pinchStart.current.pan.x) / pinchStart.current.zoom) * nextZoom,
            y: focal.y - ((pinchStart.current.focal.y - pinchStart.current.pan.y) / pinchStart.current.zoom) * nextZoom,
          };
          zoomRef.current = nextZoom;
          panOffsetRef.current = nextPan;
          setZoom(nextZoom);
          setPanOffset(nextPan);
        }
        return;
      }
      pinchStart.current = null;
      if(toolRef.current==='select' && selectionGestureRef.current?.type==='lasso'){
        const point=screenToDocument({x:event.nativeEvent.locationX,y:event.nativeEvent.locationY},{zoom: zoomRef.current, pan: panOffsetRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2}});
        const next=[...lassoRef.current,point];lassoRef.current=next;setLassoPoints(next);return;
      }
      if(toolRef.current==='select' && selectionGestureRef.current?.type==='resize'){
        const point=screenToDocument({x:event.nativeEvent.locationX,y:event.nativeEvent.locationY},{zoom: zoomRef.current, pan: panOffsetRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2}});
        const box=getStrokeBounds(selectionGestureRef.current.original.filter(stroke=>selectedIdsRef.current.includes(stroke.id)));
        if(!box)return;
        const cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2;
        const factor=Math.max(0.25,Math.min(4,Math.hypot(point.x-cx,point.y-cy)/selectionGestureRef.current.startDistance));
        selectionGestureRef.current.factor=factor;
        const resized=resizeStrokes(selectionGestureRef.current.original,selectedIdsRef.current,factor);
        pathsRef.current=resized;setPaths(resized);return;
      }
      if(toolRef.current==='select' && selectionGestureRef.current?.type==='move'){
        const point=screenToDocument({x:event.nativeEvent.locationX,y:event.nativeEvent.locationY},{zoom: zoomRef.current, pan: panOffsetRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2}});
        const dx=point.x-selectionGestureRef.current.start.x,dy=point.y-selectionGestureRef.current.start.y;
        const moved=selectionGestureRef.current.original.map(stroke=>selectedIdsRef.current.includes(stroke.id)?{...stroke,points:stroke.points.map(p=>({x:p.x+dx,y:p.y+dy}))}:stroke);
        pathsRef.current=moved;setPaths(moved);return;
      }
      if (toolRef.current === 'move') {
        const next = { x: moveStart.current.x + gestureState.dx, y: moveStart.current.y + gestureState.dy };
        panOffsetRef.current = next; setPanOffset(next); return;
      }
      const point = screenToDocument({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }, { zoom: zoomRef.current, pan: panOffsetRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2} });
      if (toolRef.current === 'eraser') {
        const previous = pathsRef.current;
        const next = eraserModeRef.current === 'whole'
          ? eraseWholeStrokesAtPoint(previous, point, eraserSizeRef.current)
          : eraseAtPoint(previous, point, eraserSizeRef.current);
        const changed = next.length !== previous.length || next.some((path, index) => path !== previous[index]);
        if (changed) {
          pathsRef.current = next;
          setPaths(next);
        }
        return;
      }
      if (!activePath.current) return;
      const updated = { ...activePath.current, points: [...activePath.current.points, point] };
      activePath.current = updated;
      pathsRef.current = [...pathsRef.current.slice(0, -1), updated];
      setPaths(pathsRef.current);
    },
    onPanResponderRelease: (event) => {
      if(toolRef.current==='select' && selectionGestureRef.current?.type==='lasso'){
        const polygon=lassoRef.current;
        const ids=polygon.length>=3?pathsRef.current.filter(stroke=>pathIntersectsPolygon(stroke, polygon)).map(stroke=>stroke.id):[];
        selectedIdsRef.current=ids;setSelectedStrokeIds(ids);lassoRef.current=[];setLassoPoints([]);
      }else if(toolRef.current==='select' && selectionGestureRef.current?.type==='resize'){
        const resized=resizeStrokes(selectionGestureRef.current.original,selectedIdsRef.current,selectionGestureRef.current.factor||1);
        pathsRef.current=resized;setPaths(resized);setRedoPaths([]);
      }else if(toolRef.current==='select' && selectionGestureRef.current?.type==='move'){
        const point = screenToDocument({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }, { zoom: zoomRef.current, pan: panOffsetRef.current, origin:{x:canvasSizeRef.current.width/2,y:canvasSizeRef.current.height/2} });
        const dx=point.x-selectionGestureRef.current.start.x,dy=point.y-selectionGestureRef.current.start.y;
        const moved=selectionGestureRef.current.original.map(stroke=>selectedIdsRef.current.includes(stroke.id)?{...stroke,points:stroke.points.map(p=>({x:p.x+dx,y:p.y+dy}))}:stroke);
        pathsRef.current=moved;setPaths(moved);setRedoPaths([]);
      }
      recordPathSnapshotRef.current();
      selectionGestureRef.current=null;
      activePath.current=null;
      if ((event.nativeEvent.touches?.length || 0) < 2) pinchStart.current = null;
    },
    onPanResponderTerminate: () => {
      activePath.current = null;
      pinchStart.current = null;
      selectionGestureRef.current=null;
      lassoRef.current=[];
      setLassoPoints([]);
    },
  }), []);

  const changePage = (nextIndex) => {
    if (nextIndex < 0 || nextIndex >= pages.length) return;
    setPages((previous) => previous.map((page, index) => index === pageIndex ? { ...page, paths, text: pageText, background: pageBackground } : page));
    const nextPage = pages[nextIndex];
    const nextPaths = nextPage.paths || [];
    setPageIndex(nextIndex);
    pathsRef.current = nextPaths;
    setPaths(nextPaths);
    setRedoPaths([]);
    setSelectedStrokeIds([]);
    selectedIdsRef.current = [];
    setLassoPoints([]);
    lassoRef.current = [];
    setPageText(nextPage.text || '');
    setPageBackground(nextPage.background || 'plain');
    const nextHistory = createHistory({ paths: nextPaths, text: nextPage.text || '', background: nextPage.background || 'plain' });
    pathHistoryRef.current = nextHistory;
    setPathHistory(nextHistory);
    setZoom(1); setPanOffset({ x: 0, y: 0 });
  };
  const undo = () => {
    const nextHistory = undoHistory(pathHistoryRef.current);
    if (nextHistory === pathHistoryRef.current) return;
    pathHistoryRef.current = nextHistory;
    setPathHistory(nextHistory);
    applySnapshot(nextHistory.present);
    setRedoPaths([]);
  };
  const redo = () => {
    const nextHistory = redoHistory(pathHistoryRef.current);
    if (nextHistory === pathHistoryRef.current) return;
    pathHistoryRef.current = nextHistory;
    setPathHistory(nextHistory);
    applySnapshot(nextHistory.present);
    setRedoPaths([]);
  };
  const getLatestDocument = () => {
    const updatedPages = pages.map((page, index) => index === pageIndex ? { ...page, paths: pathsRef.current, text: pageTextRef.current, background: pageBackgroundRef.current } : page);
    return { ...document, title: titleRef.current, pages: updatedPages, uri: updatedPages[0]?.uri, paths: updatedPages[0]?.paths || [], updatedAt: Date.now() };
  };
  const save = () => onSave(getLatestDocument());
  const exportPdf = async () => {
    try {
      const snapshot = getLatestDocument();
      const saved = await onChange(snapshot);
      if (saved === false) throw new Error('Não foi possível salvar a nota antes da exportação.');
      const width = Math.max(1, canvasSize.width || 800), height = Math.max(1, canvasSize.height || 1100);
      const pageMarkup = snapshot.pages.map((page, index) => {
        const image = page.uri ? `<img class="page-image" src="${escapeHtml(page.uri)}" />` : '';
        const strokes = (page.paths || []).map(stroke => `<path d="${escapeHtml(pathToSvg(stroke.points || []))}" stroke="${escapeHtml(stroke.color || '#202124')}" stroke-width="${Number(stroke.width) || 2}" stroke-opacity="${Number(stroke.opacity ?? 1)}" stroke-linecap="round" stroke-linejoin="round" fill="none" />`).join('');
        const typed = escapeHtml(page.text || '').split('\n').join('<br/>');
        return `<section class="page"><header>${escapeHtml(snapshot.title || 'Minha nota')} · Página ${index + 1}</header><div class="sheet">${image}<div class="typed">${typed}</div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${strokes}</svg></div></section>`;
      }).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#203B32;margin:0}.page{page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}header{font-size:10px;color:#69766D;margin:0 0 8px}.sheet{position:relative;width:100%;height:265mm;overflow:hidden;background:#fff;border:1px solid #e7e8e1}.page-image{position:absolute;width:100%;height:100%;object-fit:contain;inset:0}.typed{position:absolute;inset:12mm 10mm;white-space:normal;overflow-wrap:anywhere;font-size:12px;line-height:1.6;z-index:1}svg{position:absolute;inset:0;width:100%;height:100%;z-index:2}</style></head><body>${pageMarkup}</body></html>`;
      const file = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: `Exportar ${snapshot.title || 'nota'} em PDF` });
    } catch (error) {
      console.error('Erro ao exportar PDF:', error);
      Alert.alert('Não foi possível exportar o PDF', error?.message || 'Tente novamente.');
    }
  };
  const currentPage = pages[pageIndex];
  const documentRef = useRef(document);
  const onChangeRef = useRef(onChange);
  documentRef.current = document;
  onChangeRef.current = onChange;

  useEffect(() => {
    let active = true;
    const updatedPages = pages.map((page, index) => index === pageIndex
      ? { ...page, paths, text: pageText, background: pageBackground }
      : page);
    setSaveState('pending');
    const timer = setTimeout(async () => {
      if (!active) return;
      setSaveState('saving');
      const latestDocument = documentRef.current;
      try {
        const saved = await onChangeRef.current({
          ...latestDocument,
          title: titleRef.current,
          pages: updatedPages,
          uri: updatedPages[0]?.uri,
          paths: updatedPages[0]?.paths || [],
          updatedAt: Date.now(),
        });
        if (active) setSaveState(saved === false ? 'error' : 'saved');
      } catch (error) {
        console.error('Erro no salvamento automático da nota:', error);
        if (active) setSaveState('error');
      }
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [pageIndex, pages, paths, pageText, pageBackground, title]);

  const addPage = () => {
    const current = { ...pages[pageIndex], paths, text: pageText, background: pageBackground };
    const nextPage = { id: `page-${Date.now()}`, paths: [], text: '', background: 'plain' };
    const nextPages = [...pages.map((page, index) => index === pageIndex ? current : page), nextPage];
    setPages(nextPages);
    setPageIndex(nextPages.length - 1);
    pathsRef.current = [];
    setPaths([]);
    setPageText('');
    setPageBackground('plain');
    setSelectedStrokeIds([]);
    selectedIdsRef.current = [];
    setLassoPoints([]);
    lassoRef.current = [];
    const nextHistory = createHistory({ paths: [], text: '', background: 'plain' });
    pathHistoryRef.current = nextHistory;
    setPathHistory(nextHistory);
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const reorderPage = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= pages.length) return;
    const currentPages = pages.map((page, pagePosition) => pagePosition === pageIndex
      ? { ...page, paths, text: pageText, background: pageBackground }
      : page);
    const nextPages = [...currentPages];
    [nextPages[index], nextPages[targetIndex]] = [nextPages[targetIndex], nextPages[index]];
    const activeId = currentPages[pageIndex]?.id;
    setPages(nextPages);
    setPageIndex(nextPages.findIndex(page => page.id === activeId));
  };

  const removeCurrentPage = () => {
    if (pages.length <= 1) {
      Alert.alert('Não é possível excluir', 'Um caderno precisa ter pelo menos uma página.');
      return;
    }
    Alert.alert('Excluir página?', 'O conteúdo desta página será removido do caderno.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir página', style: 'destructive', onPress: () => {
        const nextPages = pages.filter((_, index) => index !== pageIndex);
        const nextIndex = Math.max(0, Math.min(pageIndex, nextPages.length - 1));
        const next = nextPages[nextIndex];
        setPages(nextPages);
        setPageIndex(nextIndex);
        pathsRef.current = next.paths || [];
        setPaths(next.paths || []);
        setPageText(next.text || '');
        setPageBackground(next.background || 'plain');
        setSelectedStrokeIds([]);
        selectedIdsRef.current = [];
        const nextHistory = createHistory({ paths: next.paths || [], text: next.text || '', background: next.background || 'plain' });
        pathHistoryRef.current = nextHistory;
        setPathHistory(nextHistory);
      } },
    ]);
  };

  return (
    <SafeAreaView style={styles.examLikeEditorSafe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.ink} />
      <View style={styles.examLikeHeader}>
        <Pressable onPress={save} style={styles.examLikeBack}><Text style={styles.examLikeBackText}>‹</Text></Pressable>
        <View style={styles.examLikeTitleWrap}>
          <TextInput value={title} onChangeText={nextTitle => { titleRef.current = nextTitle; setTitle(nextTitle); onChange({ ...document, title: nextTitle, updatedAt: Date.now() }); }} style={styles.examLikeTitleInput} maxLength={70} />
          <Text style={styles.examLikeSubtitle}>{saveState === 'pending' || saveState === 'saving' ? 'Salvando alterações…' : saveState === 'error' ? 'Falha ao salvar · tente novamente' : 'Todas as alterações salvas'}</Text>
        </View>
        <Pressable onPress={exportPdf} style={[styles.examLikeSave, { marginRight: 7, backgroundColor: '#E8F0E9' }]}><Text style={[styles.examLikeSaveText, { color: COLORS.green }]}>PDF</Text></Pressable>
        <Pressable onPress={save} style={styles.examLikeSave}><Text style={styles.examLikeSaveText}>Salvar</Text></Pressable>
      </View>

      <ContextToolbar>
        <IconButton label="↶" accessibilityLabel="Desfazer" onPress={undo} disabled={pathHistory.past.length <= 1} />
        <IconButton label="↷" accessibilityLabel="Refazer" onPress={redo} disabled={!pathHistory.future.length} />
        <View style={{ flex: 1 }} />
        <View style={styles.examLikeCounter}><Text style={styles.examLikeCounterText}>{String(pageIndex + 1).padStart(2, '0')} / {String(pages.length).padStart(2, '0')}</Text></View>
      </ContextToolbar>

      <View style={styles.examLikeCanvasArea}>
        <View style={styles.examLikeCanvas} onLayout={(event) => setCanvasSize(event.nativeEvent.layout)}>
          <View style={[styles.zoomContent, { transform: [{ translateX: panOffset.x }, { translateY: panOffset.y }, { scale: zoom }] }]}>
            {currentPage.uri
              ? <>
                  <Image source={{ uri: currentPage.uri }} style={styles.examImage} resizeMode="contain" />
                  <TextInput
                    value={pageText}
                    onChangeText={setPageText}
                    onEndEditing={() => recordPathSnapshot()}
                    editable={tool === 'text'}
                    placeholder={tool === 'text' ? 'Digite nesta página...' : ''}
                    placeholderTextColor="#A0AAA1"
                    multiline
                    textAlignVertical="top"
                    style={[styles.pageTextInput, styles.pageTextOnImage]}
                  />
                </>
              : <View style={styles.blankPage}>
                  <PageBackground type={pageBackground} />
                  <TextInput value={pageText} onChangeText={setPageText} onEndEditing={() => recordPathSnapshot()} editable={tool === 'text'} placeholder={tool === 'text' ? 'Digite nesta página...' : 'Selecione Texto para digitar'} placeholderTextColor="#A0AAA1" multiline textAlignVertical="top" style={styles.pageTextInput} />
                </View>}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Svg width={canvasSize.width} height={canvasSize.height}>
                {paths.map(path => <Path key={path.id} d={pathToSvg(path.points)} stroke={path.color} strokeWidth={path.width} strokeOpacity={path.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
                {lassoPoints.length > 1 && <Path d={pathToSvg(lassoPoints)} stroke={COLORS.green} strokeWidth={2} strokeDasharray="5 4" fill="none" />}
                {selectedStrokeIds.length > 0 && (() => {
                  const bounds = getStrokeBounds(paths.filter(path => selectedStrokeIds.includes(path.id)));
                  return bounds ? <><Rect x={bounds.minX - 7} y={bounds.minY - 7} width={Math.max(20, bounds.maxX - bounds.minX + 14)} height={Math.max(20, bounds.maxY - bounds.minY + 14)} stroke={COLORS.green} strokeWidth={1.5} strokeDasharray="5 4" fill="none" /><Rect x={bounds.maxX + 1} y={bounds.maxY + 1} width={12} height={12} rx={3} fill={COLORS.green} /></> : null;
                })()}
              </Svg>
            </View>
            <View pointerEvents={tool === 'text' ? 'none' : 'auto'} style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />
          </View>
        </View>
      </View>

      <View style={styles.examLikePageControls}>
        <Pressable disabled={pageIndex === 0} onPress={() => changePage(pageIndex - 1)} style={[styles.examLikePageButton, pageIndex === 0 && styles.toolDisabled]}><Text style={styles.examLikePageButtonText}>‹</Text></Pressable>
        <View style={styles.examLikePageProgress}>
          <Text style={styles.examLikePageLabel}>Página {pageIndex + 1} de {pages.length}</Text>
          <View style={styles.examLikeProgressTrack}><View style={[styles.examLikeProgressFill, { width: `${((pageIndex + 1) / Math.max(1, pages.length)) * 100}%` }]} /></View>
        </View>
        <Pressable onPress={addPage} style={styles.examLikePageButton} accessibilityRole="button" accessibilityLabel="Adicionar página"><Text style={styles.examLikePageButtonText}>＋</Text></Pressable>
        <Pressable onPress={removeCurrentPage} style={[styles.examLikePageButton, { marginLeft: 6 }]} accessibilityRole="button" accessibilityLabel="Excluir página"><Text style={styles.examLikePageButtonText}>⌫</Text></Pressable>
        <Pressable disabled={pageIndex === pages.length - 1} onPress={() => changePage(pageIndex + 1)} style={[styles.examLikePageButton, { marginLeft: 6 }, pageIndex === pages.length - 1 && styles.toolDisabled]}><Text style={styles.examLikePageButtonText}>›</Text></Pressable>
      </View>
      <ScrollView horizontal style={styles.pageThumbnailStrip} contentContainerStyle={styles.pageThumbnailContent} showsHorizontalScrollIndicator={false}>
        {pages.map((page, index) => (
          <View key={page.id || index} style={[styles.pageThumbnailCard, index === pageIndex && styles.pageThumbnailCardActive]}>
            <Pressable onPress={() => changePage(index)} style={styles.pageThumbnailOpen} accessibilityRole="button" accessibilityLabel={`Abrir página ${index + 1}`}>
              {page.uri ? <Image source={{ uri: page.uri }} style={styles.pageThumbnailImage} resizeMode="cover" /> : <View style={styles.pageThumbnailBlank}><Text style={styles.pageThumbnailGlyph}>{page.paths?.length || page.text ? '✎' : '＋'}</Text></View>}
              <Text style={[styles.pageThumbnailLabel, index === pageIndex && styles.pageThumbnailLabelActive]}>{String(index + 1).padStart(2, '0')}</Text>
            </Pressable>
            <View style={styles.pageThumbnailActions}>
              <Pressable disabled={index === 0} onPress={() => reorderPage(index, -1)} style={styles.pageThumbnailMove}><Text style={styles.pageThumbnailMoveText}>‹</Text></Pressable>
              <Pressable disabled={index === pages.length - 1} onPress={() => reorderPage(index, 1)} style={styles.pageThumbnailMove}><Text style={styles.pageThumbnailMoveText}>›</Text></Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      <ScrollView style={[styles.examLikeDrawPanel, { maxHeight: toolsExpanded ? 310 : 116 }]} contentContainerStyle={{ paddingBottom: toolsExpanded ? 9 : 4 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.examLikeHint}>{tool === 'select' ? (selectedStrokeIds.length ? `${selectedStrokeIds.length} selecionado(s) · arraste para mover` : 'Contorne a escrita com o dedo para selecionar.') : tool === 'text' ? 'Toque na folha para digitar. Volte à caneta para desenhar.' : 'Escolha uma ferramenta para escrever ou anotar.'}</Text>
        {selectedStrokeIds.length > 0 && <View style={styles.selectionActionRow}>
          <Text style={styles.selectionCount}>{selectedStrokeIds.length} selecionado(s)</Text>
          <Pressable onPress={() => applyPathChange(resizeStrokes(pathsRef.current, selectedStrokeIds, 1.15))} style={styles.selectionAction}><Text style={styles.selectionActionText}>＋ Tamanho</Text></Pressable>
          <Pressable onPress={() => applyPathChange(resizeStrokes(pathsRef.current, selectedStrokeIds, 0.87))} style={styles.selectionAction}><Text style={styles.selectionActionText}>− Tamanho</Text></Pressable>
          <Pressable onPress={() => applyPathChange(rotateStrokes(pathsRef.current, selectedStrokeIds, Math.PI / 12))} style={styles.selectionAction}><Text style={styles.selectionActionText}>↻ Girar</Text></Pressable>
          <Pressable onPress={() => { const picked = pathsRef.current.filter(path => selectedStrokeIds.includes(path.id)); setSelectedClipboard(picked); applyPathChange(pathsRef.current.filter(path => !selectedStrokeIds.includes(path.id))); setSelectedStrokeIds([]); }} style={styles.selectionAction}><Text style={styles.selectionActionText}>Cortar</Text></Pressable>
          <Pressable onPress={() => { if (!selectedClipboard.length) return; const pasted = selectedClipboard.map(path => ({ ...path, id: `${Date.now()}-${Math.random()}`, points: path.points.map(point => ({ x: point.x + 24, y: point.y + 24 })) })); applyPathChange([...pathsRef.current, ...pasted]); setSelectedStrokeIds(pasted.map(path => path.id)); }} style={styles.selectionAction}><Text style={styles.selectionActionText}>Colar</Text></Pressable>
          <Pressable onPress={() => { applyPathChange(pathsRef.current.filter(path => !selectedStrokeIds.includes(path.id))); setSelectedStrokeIds([]); }} style={styles.selectionAction}><Text style={[styles.selectionActionText, { color: COLORS.rose }]}>Excluir</Text></Pressable>
          <Pressable onPress={() => setSelectedStrokeIds([])} style={styles.selectionAction}><Text style={styles.selectionActionText}>Nova seleção</Text></Pressable>
        </View>}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.examLikeQuickTools}>
          {[
            { id: 'pen', glyph: '✎', label: 'Caneta' },
            { id: 'highlighter', glyph: '▰', label: 'Marca-texto' },
            { id: 'eraser', glyph: '⌫', label: 'Borracha' },
            { id: 'select', glyph: '⌁', label: 'Laço' },
            { id: 'move', glyph: '✥', label: 'Mover' },
            { id: 'text', glyph: 'T', label: 'Texto' },
          ].map(item => <Pressable key={item.id} onPress={() => { setTool(item.id); if (item.id !== 'select') { setSelectedStrokeIds([]); selectedIdsRef.current = []; setLassoPoints([]); lassoRef.current = []; } }} style={[styles.examLikeQuickTool, tool === item.id && styles.examLikeQuickToolActive]}>
            <Text style={styles.examLikeQuickGlyph}>{item.glyph}</Text>
            <Text style={[styles.examLikeQuickLabel, tool === item.id && styles.examLikeQuickLabelActive]}>{item.label}</Text>
          </Pressable>)}
          <Pressable onPress={() => setToolsExpanded(value => !value)} style={[styles.moreToolsButton, toolsExpanded && styles.moreToolsButtonActive]}><Text style={styles.moreToolsGlyph}>{toolsExpanded ? '⌃' : '•••'}</Text><Text style={styles.moreToolsText}>{toolsExpanded ? 'Fechar' : 'Mais'}</Text></Pressable>
        </ScrollView>

        {toolsExpanded && <View style={styles.expandedTools}>
          <View style={styles.examLikeActionTools}>
            <Pressable onPress={() => setTool('pen')} style={[styles.examLikeTool, tool === 'pen' && styles.examLikeToolActive]}><Text style={styles.examLikeToolText}>✎ Caneta</Text></Pressable>
            <Pressable onPress={() => setTool('highlighter')} style={[styles.examLikeTool, tool === 'highlighter' && styles.examLikeToolActive]}><Text style={styles.examLikeToolText}>▰ Marca-texto</Text></Pressable>
            <Pressable onPress={() => setTool('eraser')} style={[styles.examLikeTool, tool === 'eraser' && styles.examLikeToolActive]}><Text style={styles.examLikeToolText}>⌫ Borracha</Text></Pressable>
            <Pressable onPress={() => setTool('move')} style={[styles.examLikeTool, tool === 'move' && styles.examLikeToolActive]}><Text style={styles.examLikeToolText}>✥ Mover folha</Text></Pressable>
            <Pressable onPress={() => setTool('text')} style={[styles.examLikeTool, tool === 'text' && styles.examLikeToolActive]}><Text style={styles.examLikeToolText}>T Texto</Text></Pressable>
            <Pressable onPress={() => Alert.alert('Limpar anotações desta página?', 'Esta ação pode ser desfeita pelo botão Desfazer.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Limpar página', style: 'destructive', onPress: () => { applyPathChange([]); setSelectedStrokeIds([]); selectedIdsRef.current = []; } }])} style={styles.examLikeTool}><Text style={styles.examLikeToolText}>⌫ Limpar página</Text></Pressable>
          </View>
          {tool === 'pen' && <>
            <View style={styles.strokePicker}>
              <View style={styles.strokePickerHeader}><Text style={styles.paletteTitle}>ESPESSURA DA CANETA</Text><Text style={styles.strokeValue}>{strokeWidth}px</Text></View>
              <View style={styles.strokeOptions}>{[{ width: 2, label: 'Fina' }, { width: 4, label: 'Média' }, { width: 7, label: 'Grossa' }, { width: 11, label: 'Extra' }].map(option => <Pressable key={option.width} onPress={() => setStrokeWidth(option.width)} style={[styles.strokeOption, strokeWidth === option.width && styles.strokeOptionActive]}><View style={styles.strokePreview}><View style={[styles.strokeLine, { height: option.width, borderRadius: option.width / 2 }]} /></View><Text style={[styles.strokeOptionLabel, strokeWidth === option.width && styles.strokeOptionLabelActive]}>{option.label}</Text></Pressable>)}</View>
            </View>
            <View style={styles.strokePicker}>
              <Text style={styles.paletteTitle}>OPACIDADE</Text>
              <View style={styles.strokeOptions}>{[{ value: 0.45, label: '45%' }, { value: 0.7, label: '70%' }, { value: 0.85, label: '85%' }, { value: 1, label: '100%' }].map(option => <Pressable key={option.value} onPress={() => setPenOpacity(option.value)} style={[styles.strokeOption, penOpacity === option.value && styles.strokeOptionActive]}><View style={[styles.opacityPreview, { backgroundColor: color, opacity: option.value }]} /><Text style={[styles.strokeOptionLabel, penOpacity === option.value && styles.strokeOptionLabelActive]}>{option.label}</Text></Pressable>)}</View>
            </View>
          </>}
          {tool === 'eraser' && <View style={styles.strokePicker}>
            <View style={styles.strokePickerHeader}><Text style={styles.paletteTitle}>TAMANHO DA BORRACHA</Text><Text style={styles.strokeValue}>{eraserSize}px</Text></View>
            <View style={styles.strokeOptions}>{[{ value: 12, label: 'Pequena' }, { value: 24, label: 'Média' }, { value: 40, label: 'Grande' }, { value: 60, label: 'Extra' }].map(option => <Pressable key={option.value} onPress={() => setEraserSize(option.value)} style={[styles.strokeOption, eraserSize === option.value && styles.strokeOptionActive]}><View style={styles.strokePreview}><View style={[styles.eraserPreview, { width: Math.min(42, option.value), height: Math.min(18, option.value / 2) }]} /></View><Text style={[styles.strokeOptionLabel, eraserSize === option.value && styles.strokeOptionLabelActive]}>{option.label}</Text></Pressable>)}</View>
            <View style={styles.markerTypes}><Text style={styles.paletteTitle}>MODO DE APAGAR</Text><Pressable onPress={() => setEraserMode('partial')} style={[styles.markerType, eraserMode === 'partial' && styles.markerTypeActive]}><Text style={[styles.markerTypeText, eraserMode === 'partial' && styles.markerTypeTextActive]}>Parte do traço</Text></Pressable><Pressable onPress={() => setEraserMode('whole')} style={[styles.markerType, eraserMode === 'whole' && styles.markerTypeActive]}><Text style={[styles.markerTypeText, eraserMode === 'whole' && styles.markerTypeTextActive]}>Traço inteiro</Text></Pressable></View>
          </View>}
          {tool === 'highlighter' && <>
            <View style={styles.strokePicker}><View style={styles.strokePickerHeader}><Text style={styles.paletteTitle}>ESPESSURA DO MARCA-TEXTO</Text><Text style={styles.strokeValue}>{markerWidth}px</Text></View><View style={styles.strokeOptions}>{[{ width: 10, label: 'Fina' }, { width: 18, label: 'Média' }, { width: 28, label: 'Larga' }].map(option => <Pressable key={option.width} onPress={() => setMarkerWidth(option.width)} style={[styles.strokeOption, markerWidth === option.width && styles.strokeOptionActive]}><View style={styles.strokePreview}><View style={[styles.markerStrokeLine, { height: Math.min(18, Math.max(6, option.width / 1.5)) }]} /></View><Text style={[styles.strokeOptionLabel, markerWidth === option.width && styles.strokeOptionLabelActive]}>{option.label}</Text></Pressable>)}</View></View>
            <View style={styles.markerTypes}><Text style={styles.paletteTitle}>ESTILO</Text>{[{ id: 'classic', label: 'Clássico' }, { id: 'pastel', label: 'Pastel' }, { id: 'bold', label: 'Forte' }, { id: 'underline', label: 'Sublinhado' }].map(item => <Pressable key={item.id} onPress={() => setMarkerType(item.id)} style={[styles.markerType, markerType === item.id && styles.markerTypeActive]}><Text style={[styles.markerTypeText, markerType === item.id && styles.markerTypeTextActive]}>{item.label}</Text></Pressable>)}</View>
          </>}
          <View style={styles.markerTypes}><Text style={styles.paletteTitle}>FUNDO</Text>{[['plain', 'Branco'], ['ruled', 'Pautado'], ['grid', 'Quadriculado'], ['dotted', 'Pontilhado']].map(([id, label]) => <Pressable key={id} onPress={() => { setPageBackground(id); recordPathSnapshot({ background: id }); }} style={[styles.markerType, pageBackground === id && styles.markerTypeActive]}><Text style={[styles.markerTypeText, pageBackground === id && styles.markerTypeTextActive]}>{label}</Text></Pressable>)}</View>
        </View>}

        {toolsExpanded && <View style={styles.examLikeBottomTools}>
          <View style={styles.paletteSection}><Text style={styles.paletteTitle}>CORES</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.palette}>{PALETTE.map(item => <Pressable key={item} onPress={() => setColor(item)} style={[styles.swatch, { backgroundColor: item, borderColor: item === '#FFFFFF' ? '#AEB5AE' : item }, color === item && styles.swatchSelected]} />)}</ScrollView></View>
          <View style={styles.examLikeBottomRow}>
            <View style={styles.zoomControls}>
              <Pressable style={styles.zoomButton} onPress={() => { const next = Math.max(0.5, Number((zoom - 0.25).toFixed(2))); zoomRef.current = next; setZoom(next); }}><Text style={styles.zoomButtonText}>−</Text></Pressable>
              <Text style={styles.zoomValue}>{Math.round(zoom * 100)}%</Text>
              <Pressable style={styles.zoomButton} onPress={() => { const next = Math.min(3, Number((zoom + 0.25).toFixed(2))); zoomRef.current = next; setZoom(next); }}><Text style={styles.zoomButtonText}>＋</Text></Pressable>
              <Pressable style={styles.zoomReset} onPress={() => { zoomRef.current = 1; setZoom(1); panOffsetRef.current = { x: 0, y: 0 }; setPanOffset({ x: 0, y: 0 }); }}><Text style={styles.zoomResetText}>Ajustar</Text></Pressable>
            </View>
            <Text style={styles.annotationCount}>{paths.length} traços</Text>
          </View>
          <Pressable onPress={save} style={styles.examLikeExitButton}><Text style={styles.examLikeExitButtonText}>Salvar e sair</Text></Pressable>
        </View>}
      </ScrollView>
    </SafeAreaView>
  );

}

function BlocoApp() {
  const [documents, setDocuments] = useState([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [documentsLoadError, setDocumentsLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [activeDocument, setActiveDocument] = useState(null);
  const [examMode, setExamMode] = useState(false);
  const [redacaoMode, setRedacaoMode] = useState(false);
  const persistenceTimer = useRef(null);
  const persistenceQueue = useRef(Promise.resolve());
  const documentsRef = useRef([]);

  documentsRef.current = documents;

  const enqueueDocumentsSave = snapshot => {
    persistenceQueue.current = persistenceQueue.current.catch(() => undefined).then(async () => {
      await writeArrayWithBackup(AsyncStorage, NOTEBOOKS_STORAGE_KEY, NOTEBOOKS_BACKUP_KEY, snapshot);
    });
    return persistenceQueue.current;
  };
  const cancelScheduledSave = () => {
    const pending = persistenceTimer.current;
    if (!pending) return;
    clearTimeout(pending.timer); persistenceTimer.current = null; pending.resolve(true);
  };
  const flushScheduledSave = snapshot => {
    const pending = persistenceTimer.current;
    if (pending) {
      clearTimeout(pending.timer); persistenceTimer.current = null;
      enqueueDocumentsSave(snapshot).then(() => pending.resolve(true)).catch(error => { console.error('Erro ao salvar cadernos:', error); Alert.alert('Erro ao salvar cadernos', error?.message || 'Não foi possível salvar suas anotações.'); pending.resolve(false); });
      return;
    }
    return enqueueDocumentsSave(snapshot);
  };
  const flushScheduledSaveRef = useRef(flushScheduledSave);
  flushScheduledSaveRef.current = flushScheduledSave;
  const scheduleDocumentsSave = snapshot => {
    cancelScheduledSave();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        persistenceTimer.current = null;
        enqueueDocumentsSave(snapshot).then(() => resolve(true)).catch(error => { console.error('Erro ao salvar cadernos:', error); Alert.alert('Erro ao salvar cadernos', error?.message || 'Não foi possível salvar suas anotações.'); resolve(false); });
      }, 250);
      persistenceTimer.current = { timer, resolve };
    });
  };

  useEffect(() => {
    let mounted = true;
    readArrayWithBackup(AsyncStorage, NOTEBOOKS_STORAGE_KEY, NOTEBOOKS_BACKUP_KEY)
      .then(({ items, recovered }) => {
        if (recovered) Alert.alert('Cadernos recuperados', 'O Bloco encontrou um backup automático e recuperou seus documentos.');
        if (mounted) { documentsRef.current = items; setDocuments(items); }
      })
      .catch(error => { if (mounted) setDocumentsLoadError(error?.message || 'Não foi possível recuperar suas anotações.'); })
      .finally(() => {
        if (mounted) setDocumentsLoaded(true);
      });
    return () => { mounted = false; };
  }, [loadAttempt]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        flushScheduledSaveRef.current(documentsRef.current)?.catch(error => {
          console.error('Erro ao salvar cadernos em segundo plano:', error);
        });
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => () => {
    flushScheduledSave(documentsRef.current)?.catch(error => {
      console.error('Erro ao finalizar persistência dos cadernos:', error);
    });
  }, []);

  const commitDocuments = (next, immediate = false) => {
    documentsRef.current = next;
    setDocuments(next);
    if (immediate) {
      cancelScheduledSave();
      return enqueueDocumentsSave(next);
    }
    return scheduleDocumentsSave(next);
  };

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
      const directory = await FileSystem.getInfoAsync(NOTEBOOKS_FILES_DIRECTORY);
      if (!directory.exists) await FileSystem.makeDirectoryAsync(NOTEBOOKS_FILES_DIRECTORY, { intermediates: true });
      const importedAt = Date.now();
      const pages = await Promise.all(result.assets.map(async (asset, index) => {
        const extension = (asset.fileName || asset.uri).split('.').pop()?.toLowerCase() || 'jpg';
        const destination = `${NOTEBOOKS_FILES_DIRECTORY}page-${importedAt}-${index}.${extension}`;
        await FileSystem.copyAsync({ from: asset.uri, to: destination });
        return {
          id: `page-${index + 1}-${importedAt}`,
          uri: destination,
          originalUri: asset.uri,
          paths: [],
          fileName: asset.fileName || `Página ${index + 1}`,
        };
      }));
      const newDocument = { id: `${importedAt}`, title: 'Minha prova', pages, createdAt: importedAt, updatedAt: importedAt };
      setActiveDocument(newDocument);
    } catch (error) {
      console.error('Erro ao importar páginas:', error);
      Alert.alert('Não foi possível importar as imagens', error?.message || 'Tente selecionar as imagens novamente.');
    }
  };

  const createNote = () => {
    const now = Date.now();
    setActiveDocument({ id: `${now}`, title: 'Minha nota', pages: [{ id: `page-${now}`, paths: [], text: '' }], createdAt: now, updatedAt: now });
  };

  const saveDocument = async (document) => {
    const current = documentsRef.current;
    const exists = current.some(item => item.id === document.id);
    const next = exists
      ? current.map(item => item.id === document.id ? document : item)
      : [document, ...current];
    try {
      await commitDocuments(next, true);
      setActiveDocument(null);
    } catch (error) {
      console.error('Erro ao salvar documento:', error);
      Alert.alert('Não foi possível salvar', 'Suas alterações continuam abertas. Tente salvar novamente.');
    }
  };

  const updateDocument = (document) => {
    const current = documentsRef.current;
    const exists = current.some(item => item.id === document.id);
    const next = exists
      ? current.map(item => item.id === document.id ? document : item)
      : [document, ...current];
    return commitDocuments(next);
  };

  const deleteDocument = (documentId, permanent = false) => {
    const current = documentsRef.current;
    const next = permanent
      ? current.filter(item => item.id !== documentId)
      : current.map(item => item.id === documentId ? { ...item, deletedAt: Date.now(), updatedAt: Date.now() } : item);
    return commitDocuments(next);
  };

  const duplicateDocument = (document) => {
    const duplicate = JSON.parse(JSON.stringify({
      ...document,
      id: `${Date.now()}-${Math.random()}`,
      title: `${document.title || 'Caderno'} (cópia)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    return commitDocuments([duplicate, ...documentsRef.current]);
  };

  const exportBackup = async () => {
    try {
      const [examsState, draftsState] = await Promise.all([
        readArrayWithBackup(AsyncStorage, '@bloco:exams:v1', '@bloco:exams:backup:v1'),
        readArrayWithBackup(AsyncStorage, '@bloco:redacoes:v1', '@bloco:redacoes:backup:v1'),
      ]);
      const documentsWithAssets = await packLocalPageAssets(documentsRef.current);
      const examsWithAssets = await packLocalPageAssets(examsState.items);
      const payload = { format: 'bloco-backup', version: 3, exportedAt: new Date().toISOString(), documents: documentsWithAssets, exams: examsWithAssets, drafts: draftsState.items };
      const uri = `${FileSystem.cacheDirectory}bloco-backup-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Exportar backup do Bloco' });
    } catch (error) { console.error('Erro ao exportar backup:', error); Alert.alert('Não foi possível exportar o backup', error?.message || 'Tente novamente.'); }
  };
  const importBackup = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.length) return;
      const raw = await FileSystem.readAsStringAsync(result.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 });
      const parsed = JSON.parse(raw);
      const restored = Array.isArray(parsed) ? parsed : parsed?.documents;
      const restoredExams = Array.isArray(parsed?.exams) ? parsed.exams : null;
      const restoredDrafts = Array.isArray(parsed?.drafts) ? parsed.drafts : null;
      if (!Array.isArray(restored) || restored.some(item => !item || item.id == null || (item.pages != null && !Array.isArray(item.pages))) || (restoredExams && restoredExams.some(item => !item || item.id == null)) || (restoredDrafts && restoredDrafts.some(item => !item || item.id == null))) throw new Error('Este arquivo não parece ser um backup válido do Bloco.');
      Alert.alert('Restaurar backup?', `Serão restaurados ${restored.length} documentos${restoredExams ? `, ${restoredExams.length} provas` : ''}${restoredDrafts ? ` e ${restoredDrafts.length} redações` : ''}. O conteúdo atual ficará preservado nos backups automáticos.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Restaurar', style: 'destructive', onPress: async () => {
          const [currentExams, currentDrafts] = await Promise.all([AsyncStorage.getItem('@bloco:exams:v1'), AsyncStorage.getItem('@bloco:redacoes:v1')]);
          const currentDocuments = documentsRef.current;
          try {
            const restoredDocuments = await restoreLocalPageAssets(restored);
            const restoredExamItems = restoredExams ? await restoreLocalPageAssets(restoredExams) : null;
            if (restoredExamItems) {
              if (currentExams !== null) await AsyncStorage.setItem('@bloco:exams:backup:v1', currentExams);
              await AsyncStorage.setItem('@bloco:exams:v1', JSON.stringify(restoredExamItems));
            }
            if (restoredDrafts) {
              if (currentDrafts !== null) await AsyncStorage.setItem('@bloco:redacoes:backup:v1', currentDrafts);
              await AsyncStorage.setItem('@bloco:redacoes:v1', JSON.stringify(restoredDrafts));
            }
            const saved = await commitDocuments(restoredDocuments, true);
            if (saved === false) throw new Error('Não foi possível gravar os cadernos restaurados.');
            Alert.alert('Backup restaurado', 'Cadernos, provas e redações incluídos no arquivo foram recuperados.');
          } catch (error) {
            const rollbackErrors = [];
            try { if (currentExams === null) await AsyncStorage.removeItem('@bloco:exams:v1'); else await AsyncStorage.setItem('@bloco:exams:v1', currentExams); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
            try { if (currentDrafts === null) await AsyncStorage.removeItem('@bloco:redacoes:v1'); else await AsyncStorage.setItem('@bloco:redacoes:v1', currentDrafts); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
            try { await commitDocuments(currentDocuments, true); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
            const message = rollbackErrors.length ? 'A restauração falhou e a recuperação automática também encontrou um erro. Não feche o aplicativo; faça uma cópia dos dados antes de tentar novamente.' : (error?.message || 'Não foi possível restaurar o backup. Os dados anteriores foram preservados.');
            Alert.alert('Falha ao restaurar', message);
          }
        } },
      ]);
    } catch (error) { console.error('Erro ao importar backup:', error); Alert.alert('Backup inválido', error?.message || 'Não foi possível ler este arquivo.'); }
  };

  if (!documentsLoaded) return <SafeAreaView style={styles.safeArea}><Text style={styles.loadingText}>Recuperando seus cadernos...</Text></SafeAreaView>;
  if (documentsLoadError) return <SafeAreaView style={styles.safeArea}><View style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 14 }}><Text style={{ color: COLORS.ink, fontSize: 22, fontWeight: '800' }}>Não foi possível abrir seus cadernos</Text><Text style={{ color: COLORS.muted, fontSize: 14, lineHeight: 21 }}>{documentsLoadError}</Text><Text style={{ color: COLORS.rose, fontSize: 12, lineHeight: 18 }}>Seus dados não foram substituídos. Não desinstale o aplicativo nem limpe os dados do armazenamento.</Text><Pressable onPress={() => { setDocumentsLoadError(''); setDocumentsLoaded(false); setLoadAttempt(value => value + 1); }} style={{ backgroundColor: COLORS.green, padding: 15, borderRadius: 12, alignItems: 'center' }}><Text style={{ color: COLORS.white, fontWeight: '700' }}>Tentar novamente</Text></Pressable></View></SafeAreaView>;
  if (activeDocument) return <EditorScreen key={activeDocument.id} document={activeDocument} onSave={saveDocument} onChange={updateDocument} />;
  if (examMode) return <ExamMode onExit={() => setExamMode(false)} />;
  if (redacaoMode) return <RedacaoMode onExit={() => setRedacaoMode(false)} />;
  return <HomeScreen documents={documents} onImport={importImages} onExportBackup={exportBackup} onImportBackup={importBackup} onCreateNote={createNote} onOpen={setActiveDocument} onDelete={deleteDocument} onUpdate={updateDocument} onDuplicate={duplicateDocument} onExam={() => setExamMode(true)} onRedacao={() => setRedacaoMode(true)} />;
}
export default function App() {
  return (
    <SafeAreaProvider>
      <BlocoApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingText: { flex: 1, textAlign: 'center', textAlignVertical: 'center', color: COLORS.muted, fontSize: 14 },
  pageNavigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingVertical: 8, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.line },
  pageNavButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: COLORS.greenLight },
  pageNavText: { color: COLORS.green, fontSize: 10, fontWeight: '700' },
  pageNavLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  safeArea: { flex: 1, backgroundColor: COLORS.paper },
  homeContent: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 34 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 34 },
  brand: { color: COLORS.ink, fontSize: 38, lineHeight: 44, fontFamily: 'serif', fontStyle: 'italic', letterSpacing: -1.8 },
  headerSubtitle: { color: COLORS.muted, fontSize: 11, letterSpacing: 1.1, marginTop: -2 },
  quickAddButton: { width: 44, height: 44, borderRadius: 15, backgroundColor: COLORS.ink, alignItems: 'center', justifyContent: 'center' },
  quickAddGlyph: { color: COLORS.white, fontSize: 27, fontWeight: '300', lineHeight: 29 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, paddingHorizontal: 13, marginBottom: 18 },
  searchIcon: { color: COLORS.green, fontSize: 23, marginRight: 8 },
  searchClear: { color: COLORS.muted, fontSize: 22, paddingHorizontal: 5, paddingVertical: 3 },
  organizeButton: { backgroundColor: COLORS.greenLight, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10 },
  organizeButtonText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  folderSection: { marginBottom: 15 },
  folderSectionLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  folderChips: { flexDirection: 'row', gap: 7, paddingRight: 10 },
  folderChip: { backgroundColor: '#FFFFFF', borderColor: COLORS.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  folderChipActive: { backgroundColor: COLORS.greenLight, borderColor: '#B8CDBB' },
  folderChipText: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  folderChipTextActive: { color: COLORS.green },
  bulkBar: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, marginBottom: 12, backgroundColor: '#E8F0E9', borderRadius: 13 },
  bulkBarText: { color: COLORS.green, fontSize: 10, fontWeight: '800', flex: 1 },
  bulkAction: { backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9 },
  bulkDanger: { backgroundColor: '#FBEFED' },
  bulkActionText: { color: COLORS.green, fontSize: 9, fontWeight: '800' },
  disabledAction: { opacity: 0.4 },
  documentCardSelected: { borderColor: COLORS.green, backgroundColor: '#F5F9F4' },
  selectionCheck: { width: 25, height: 25, borderRadius: 8, borderWidth: 1.5, borderColor: COLORS.green, alignItems: 'center', justifyContent: 'center', marginRight: 8, backgroundColor: '#FFFFFF' },
  selectionCheckText: { color: COLORS.green, fontSize: 14, fontWeight: '900' },
  folderModalCard: { backgroundColor: COLORS.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 32, width: '100%', marginTop: 'auto' },
  folderChoice: { paddingVertical: 13, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: COLORS.line, marginBottom: 7 },
  folderChoiceText: { color: COLORS.ink, fontSize: 12, fontWeight: '700' },

  searchInput: { flex: 1, color: COLORS.ink, fontSize: 13, paddingVertical: 12 },
  searchShortcut: { color: COLORS.muted, fontSize: 12, backgroundColor: '#F1F3EE', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 3 },
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
  quickLaunchPanel: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: COLORS.line, borderRadius: 20, padding: 16, marginBottom: 24 },
  quickLaunchHeader: { marginBottom: 14 },
  quickLaunchTitle: { color: COLORS.ink, fontSize: 17, fontWeight: '800' },
  quickLaunchSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  quickLaunchRow: { flexDirection: 'row', gap: 8 },
  quickLaunchCard: { flex: 1, minHeight: 88, borderRadius: 14, padding: 11, backgroundColor: '#F1F5F0', borderWidth: 1, borderColor: '#E0EAE1' },
  quickLaunchIcon: { color: COLORS.green, fontSize: 19, fontWeight: '800', marginBottom: 6 },
  quickLaunchCardTitle: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  quickLaunchCardText: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
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
  documentThumbEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F0E9' },
  documentThumbEmptyGlyph: { color: COLORS.green, fontSize: 24, fontWeight: '700' },
  pageTextOnImage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: 18, color: COLORS.ink, backgroundColor: 'transparent' },
  thumbBadge: { position: 'absolute', right: 3, bottom: 3, width: 19, height: 19, borderRadius: 10, backgroundColor: COLORS.ink, alignItems: 'center', justifyContent: 'center' },
  thumbBadgeText: { color: 'white', fontSize: 11 },
  documentInfo: { flex: 1, marginLeft: 12 },
  documentName: { color: COLORS.ink, fontWeight: '700', fontSize: 13 },
  documentMeta: { color: COLORS.muted, fontSize: 10, marginTop: 5 },
  documentDate: { color: '#A0AAA1', fontSize: 9, marginTop: 4 },
  documentArrow: { color: '#A4ADA4', fontSize: 25, paddingHorizontal: 8 },
  moreButton: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4EF' },
  moreButtonText: { color: COLORS.green, fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 },
  filterChip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: '#EFF2EC' },
  filterChipActive: { backgroundColor: COLORS.green },
  filterText: { color: COLORS.green, fontSize: 10, fontWeight: '700' },
  filterTextActive: { color: COLORS.white },
  sortChip: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 8 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(32,59,50,0.28)' },
  quickSheet: { backgroundColor: COLORS.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 30 },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: '#C8D0C8', marginBottom: 18 },
  sheetTitle: { color: COLORS.ink, fontSize: 20, fontWeight: '800' },
  sheetSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 4, marginBottom: 16 },
  quickOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 15, padding: 14, marginBottom: 9, borderWidth: 1, borderColor: COLORS.line },
  quickOptionIcon: { color: COLORS.green, fontSize: 23, width: 40, textAlign: 'center', marginRight: 10 },
  quickOptionTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  quickOptionText: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  renameCard: { alignSelf: 'center', width: '88%', backgroundColor: COLORS.paper, borderRadius: 20, padding: 20, marginBottom: 'auto', marginTop: 'auto' },
  renameInput: { color: COLORS.ink, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, marginTop: 16 },
  renameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 15 },
  renameCancel: { paddingHorizontal: 13, paddingVertical: 10 },
  renameCancelText: { color: COLORS.muted, fontWeight: '700', fontSize: 11 },
  renameConfirm: { backgroundColor: COLORS.ink, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  renameConfirmText: { color: COLORS.white, fontWeight: '700', fontSize: 11 },
  footerNote: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 26, gap: 8 },
  footerLeaf: { color: COLORS.green, fontSize: 13 },
  footerText: { color: '#9AA298', fontSize: 10, letterSpacing: 0.2 },
  examLikeEditorSafe: { flex: 1, backgroundColor: '#F1F2EF' },
  examLikeHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 9, backgroundColor: COLORS.ink, borderBottomWidth: 1, borderColor: COLORS.ink },
  examLikeBack: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  examLikeBackText: { color: COLORS.ink, fontSize: 30, marginTop: -4 },
  examLikeTitleWrap: { flex: 1, minWidth: 0 },
  examLikeTitleInput: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', paddingVertical: 0 },
  examLikeSubtitle: { color: '#C1CEC3', fontSize: 10, marginTop: 3 },
  examLikeSave: { backgroundColor: '#315C49', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 11, borderWidth: 1, borderColor: '#6E8A79' },
  examLikeSaveText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  examLikeCounter: { backgroundColor: COLORS.greenLight, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9 },
  examLikeCounterText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  examLikeCanvasArea: { flex: 1, marginHorizontal: 9, marginTop: 8, marginBottom: 6, backgroundColor: '#F1F2EF' },
  examLikeCanvas: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 5, overflow: 'hidden', elevation: 2, shadowColor: '#202522', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  examLikePageControls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E4E7E2' },
  pageThumbnailStrip: { flexGrow: 0, maxHeight: 78, backgroundColor: '#F5F6F2', borderBottomWidth: 1, borderColor: '#E4E7E2' },
  pageThumbnailContent: { alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7 },
  pageThumbnailCard: { width: 56, height: 62, borderRadius: 9, padding: 3, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E6DF' },
  pageThumbnailCardActive: { borderColor: COLORS.green, borderWidth: 2, backgroundColor: '#E8F0E9' },
  pageThumbnailOpen: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 5 },
  pageThumbnailImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%', opacity: 0.75 },
  pageThumbnailBlank: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDF8' },
  pageThumbnailGlyph: { color: COLORS.green, fontSize: 17 },
  pageThumbnailLabel: { position: 'absolute', bottom: 1, right: 3, color: COLORS.muted, fontSize: 8, fontWeight: '800' },
  pageThumbnailLabelActive: { color: COLORS.green },
  pageThumbnailActions: { position: 'absolute', top: 2, left: 2, right: 2, flexDirection: 'row', justifyContent: 'space-between' },
  pageThumbnailMove: { width: 15, height: 15, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  pageThumbnailMoveText: { color: COLORS.green, fontSize: 12, lineHeight: 14, fontWeight: '900' },
  examLikePageButton: { width: 40, height: 36, borderRadius: 11, backgroundColor: COLORS.greenLight, alignItems: 'center', justifyContent: 'center' },
  examLikePageButtonText: { color: COLORS.green, fontSize: 24, lineHeight: 26, fontWeight: '700' },
  examLikePageProgress: { flex: 1, alignItems: 'center', marginHorizontal: 12 },
  examLikePageLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  examLikeProgressTrack: { width: '100%', maxWidth: 150, height: 3, borderRadius: 4, backgroundColor: '#E4EAE4', marginTop: 6, overflow: 'hidden' },
  examLikeProgressFill: { height: '100%', borderRadius: 4, backgroundColor: COLORS.green },
  examLikeDrawPanel: { paddingHorizontal: 12, paddingTop: 9, paddingBottom: 10, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderColor: '#E4E7E2', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  examLikeHint: { color: '#77847A', fontSize: 10, marginBottom: 7 },
  examLikeQuickTools: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5 },
  examLikeQuickTool: { minWidth: 66, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 7, borderRadius: 11, backgroundColor: '#F4F5F1' },
  examLikeQuickToolActive: { backgroundColor: '#E0ECE1', borderWidth: 1, borderColor: '#A9C4AE' },
  examLikeQuickGlyph: { color: '#52675A', fontSize: 17, lineHeight: 20 },
  examLikeQuickLabel: { color: '#667269', fontSize: 9, fontWeight: '700', marginTop: 2 },
  examLikeQuickLabelActive: { color: COLORS.green },
  examLikeActionTools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  examLikeTool: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, backgroundColor: '#F2F3EF' },
  examLikeToolActive: { backgroundColor: COLORS.greenLight },
  examLikeToolText: { color: COLORS.green, fontSize: 11, fontWeight: '700' },
  examLikeBottomTools: { borderTopWidth: 1, borderTopColor: '#F0F1EC', paddingTop: 9 },
  examLikeBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  examLikeExitButton: { backgroundColor: COLORS.ink, padding: 13, borderRadius: 12, alignItems: 'center', marginTop: 5 },
  examLikeExitButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  editorSafe: { flex: 1, backgroundColor: '#F1F2EF' },
  editorHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E7E9E5' },
  backButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#ECEFE8', alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.ink, fontSize: 31, lineHeight: 34, marginTop: -4 },
  editorTitleWrap: { flex: 1, marginLeft: 11 },
  editorTitle: { color: COLORS.ink, fontWeight: '700', fontSize: 14 },
  editorTitleInput: { flex: 1, color: COLORS.ink, fontWeight: '700', fontSize: 14, paddingVertical: 0 },
  editorSubtitle: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  saveButton: { backgroundColor: COLORS.ink, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  saveButtonText: { color: 'white', fontWeight: '700', fontSize: 11 },
  editorToolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: COLORS.line },
  lassoTopButton: { backgroundColor: '#E1EFE2', borderWidth: 1, borderColor: '#8EAF91', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginLeft: 8 },
  lassoTopButtonActive: { backgroundColor: '#CDE5D0', borderColor: COLORS.green },
  lassoTopButtonText: { color: COLORS.green, fontSize: 10, fontWeight: '900' },
  toolButton: { alignItems: 'center', justifyContent: 'center', minWidth: 48, paddingHorizontal: 4 },
  toolDisabled: { opacity: 0.3 },
  toolGlyph: { color: COLORS.ink, fontSize: 20, lineHeight: 23 },
  toolLabel: { color: '#68756C', fontSize: 8, marginTop: 2 },
  compactToolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  compactTool: { flexDirection: 'row', alignItems: 'center', minWidth: 92, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11 },
  compactToolActive: { backgroundColor: COLORS.greenLight },
  compactToolGlyph: { color: COLORS.green, fontSize: 19, marginRight: 7 },
  compactToolText: { color: COLORS.green, fontSize: 10, fontWeight: '700' },
  moreToolsButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11, backgroundColor: '#F1F3EE' },
  moreToolsButtonActive: { backgroundColor: COLORS.greenLight },
  moreToolsGlyph: { color: COLORS.green, fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  moreToolsText: { color: COLORS.green, fontSize: 10, fontWeight: '700', marginLeft: 6 },
  expandedTools: { borderTopWidth: 1, borderTopColor: '#F0F1EC', paddingTop: 7 },
  toolSettingsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4 },
  toolSettingsLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '700', marginRight: 10 },
  toolbarDivider: { width: 1, height: 29, backgroundColor: COLORS.line, marginHorizontal: 8 },
  editorSpacer: { flex: 1 },
  pageCounter: { backgroundColor: COLORS.greenLight, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  pageCounterText: { color: COLORS.green, fontSize: 9, fontWeight: '700' },
  canvasArea: { flex: 1, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 7, backgroundColor: '#F1F2EF' },
  canvasPaper: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 5, overflow: 'hidden', elevation: 2, shadowColor: '#202522', shadowOpacity: 0.08, shadowRadius: 9, shadowOffset: { width: 0, height: 2 } },
  examImage: { width: '100%', height: '100%' },
  blankPage: { flex: 1, backgroundColor: '#FFFDF8', padding: 22 },
  pageRule: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#DDE8DD' },
  pageGridColumn: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#E8EEE7' },
  pageDot: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: '#C8D6C9' },
  pageTextInput: { flex: 1, color: COLORS.ink, fontSize: 17, lineHeight: 27, backgroundColor: 'transparent' },
  zoomContent: { width: '100%', height: '100%' },
  canvasHintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 7 },
  canvasHintText: { color: '#9AA298', fontSize: 9 },
  zoomControls: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  zoomButton: { width: 27, height: 27, borderRadius: 9, backgroundColor: '#E8F0E9', alignItems: 'center', justifyContent: 'center' },
  zoomButtonText: { color: COLORS.green, fontSize: 18, fontWeight: '600', lineHeight: 22 },
  zoomValue: { color: COLORS.green, fontSize: 9, minWidth: 34, textAlign: 'center', fontWeight: '700' },
  zoomReset: { paddingHorizontal: 7, paddingVertical: 6 },
  zoomResetText: { color: COLORS.muted, fontSize: 9, fontWeight: '600' },
  drawingPanel: { backgroundColor: '#FFFFFF', paddingHorizontal: 13, paddingTop: 8, paddingBottom: 10, borderTopWidth: 1, borderTopColor: '#E4E7E2', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
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
  markerWidthPreview: { width: 30, borderRadius: 10, backgroundColor: '#E4B83F', opacity: 0.55 },
  selectionActionRow: { flexDirection:'row', flexWrap:'wrap', gap:6, paddingBottom:9, alignItems:'center' },
  selectionCount: { width:'100%', color:COLORS.muted, fontSize:10, fontWeight:'700', marginBottom:2 },
  selectionAction: { paddingHorizontal:10, paddingVertical:7, borderRadius:10, backgroundColor:COLORS.greenLight, borderWidth:1, borderColor:'#D4E2D6' },
  selectionActionText: { color:COLORS.green, fontSize:10, fontWeight:'800' },
  markerTypes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 8 },
  markerLabel: { color: COLORS.green, fontSize: 9, fontWeight: '800', marginRight: 3 },
  markerType: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F1F2EE', borderWidth: 1, borderColor: '#E3E6DF' },
  markerTypeActive: { backgroundColor: '#DCEBDD', borderColor: COLORS.green },
  markerTypeText: { color: '#667269', fontSize: 9, fontWeight: '600' },
  markerTypeTextActive: { color: COLORS.green, fontWeight: '800' },
  colorScroll: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 3 },
  colorRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F0F1EC', paddingTop: 9 },
  colorLabel: { color: '#9AA298', fontSize: 8, letterSpacing: 1.1, fontWeight: '800', marginRight: 12 },
  colorButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 5, borderWidth: 1, borderColor: 'transparent' },
  colorButtonSelected: { borderColor: '#A7BDAA' },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  panelSpacer: { flex: 1 },
  annotationCount: { color: '#9AA298', fontSize: 9 },
});
