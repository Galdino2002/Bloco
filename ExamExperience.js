import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { EXAMS, getQuestions } from './examData';

const C = { ink: '#203B32', green: '#315C49', pale: '#E8F0E9', paper: '#F7F6F1', white: '#FFFFFF', muted: '#89938A', line: '#E7E8E1', red: '#B95750', amber: '#D99A35' };
const formatTime = (seconds) => {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 3600)).padStart(2, '0')}:${String(Math.floor((safe % 3600) / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};
const parseSession = (row) => ({ ...row, questions: JSON.parse(row.questions_json), answers: JSON.parse(row.answers_json || '{}'), marked: JSON.parse(row.marked_json || '[]') });

function Button({ title, onPress, secondary = false, danger = false, disabled = false }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.buttonSecondary, danger && s.buttonDanger, disabled && { opacity: 0.35 }, pressed && { opacity: 0.75 }]}><Text style={[s.buttonText, secondary && s.buttonTextSecondary, danger && s.buttonTextDanger]}>{title}</Text></Pressable>;
}
function Tag({ children }) { return <View style={s.tag}><Text style={s.tagText}>{children}</Text></View>; }

export default function ExamExperience({ onClose }) {
  const db = useSQLiteContext();
  const [view, setView] = useState('hub');
  const [selectedExam, setSelectedExam] = useState(EXAMS[0]);
  const [selectedDay, setSelectedDay] = useState(EXAMS[0].days[0]);
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [essayDraft, setEssayDraft] = useState('');
  const [showEssay, setShowEssay] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const refreshSessions = async () => {
    const rows = await db.getAllAsync('SELECT * FROM exam_sessions ORDER BY updated_at DESC');
    setSessions(rows.map(parseSession));
  };

  useEffect(() => { refreshSessions().catch(() => Alert.alert('Erro', 'Não foi possível carregar o histórico de provas.')); }, []);

  useEffect(() => {
    if (!active || active.status !== 'running') return undefined;
    const tick = () => {
      const left = Math.max(0, Math.ceil((active.ends_at - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) finishSession(true);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [active?.id, active?.status, active?.ends_at]);

  const updateSession = async (patch) => {
    const current = activeRef.current;
    if (!current) return;
    const next = { ...current, ...patch, updated_at: Date.now() };
    await db.runAsync(
      'UPDATE exam_sessions SET status=?, remaining_seconds=?, ends_at=?, current_index=?, answers_json=?, marked_json=?, essay_text=?, updated_at=? WHERE id=?',
      next.status, next.remaining_seconds, next.ends_at, next.current_index, JSON.stringify(next.answers), JSON.stringify(next.marked), next.essay_text || '', next.updated_at, next.id
    );
    activeRef.current = next;
    setActive(next);
    await refreshSessions();
  };

  const createSession = async ({ mode, sourceUri = null, sourceName = null }) => {
    const bankQuestions = mode === 'bank' ? getQuestions(selectedExam.id) : [];
    const questions = mode === 'bank' ? bankQuestions : Array.from({ length: selectedDay.questions }, (_, index) => ({
      id: `pdf-${index + 1}`, subject: 'Caderno importado',
      prompt: `Consulte a questão ${index + 1} no caderno PDF e marque a alternativa correspondente.`,
      options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D', 'Alternativa E'], answer: null, explanation: ''
    }));
    if (!questions.length) {
      Alert.alert('Banco em preparação', 'Ainda não há questões cadastradas para este exame. Você pode importar um caderno PDF ou escolher outro exame.');
      return;
    }
    const now = Date.now();
    const duration = mode === 'bank' ? 30 * 60 : selectedDay.minutes * 60;
    const session = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      exam_id: selectedExam.id, exam_name: selectedExam.name, day_name: selectedDay.name,
      mode, source_uri: sourceUri, source_name: sourceName, questions,
      duration_seconds: duration, remaining_seconds: duration, ends_at: now + duration * 1000,
      status: 'running', current_index: 0, answers: {}, marked: [], essay_text: '', created_at: now, updated_at: now
    };
    await db.runAsync(
      'INSERT INTO exam_sessions (id, exam_id, exam_name, day_name, mode, source_uri, source_name, questions_json, duration_seconds, remaining_seconds, ends_at, status, current_index, answers_json, marked_json, essay_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      session.id, session.exam_id, session.exam_name, session.day_name, session.mode, session.source_uri, session.source_name,
      JSON.stringify(session.questions), session.duration_seconds, session.remaining_seconds, session.ends_at, session.status,
      0, '{}', '[]', '', now, now
    );
    setActive(session);
    setEssayDraft('');
    setShowEssay(false);
    setSecondsLeft(duration);
    setView('room');
    await refreshSessions();
  };

  const importPdf = async () => {
    try {
      setBusy(true);
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const directory = `${FileSystem.documentDirectory}exam-pdfs/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const safeName = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const savedUri = `${directory}${Date.now()}-${safeName}`;
      await FileSystem.copyAsync({ from: asset.uri, to: savedUri });
      await createSession({ mode: 'pdf', sourceUri: savedUri, sourceName: asset.name });
    } catch (error) {
      Alert.alert('Não foi possível importar o PDF', 'Tente selecionar o arquivo novamente.');
    } finally { setBusy(false); }
  };

  const resumeSession = async (session) => {
    const now = Date.now();
    const remaining = session.status === 'running' ? Math.max(0, Math.ceil((session.ends_at - now) / 1000)) : session.remaining_seconds;
    if (remaining <= 0) {
      Alert.alert('Tempo encerrado', 'O tempo desta sessão terminou. Finalize para consultar o resultado.');
      return;
    }
    const next = { ...session, status: 'running', remaining_seconds: remaining, ends_at: now + remaining * 1000, updated_at: now };
    await db.runAsync('UPDATE exam_sessions SET status=?, remaining_seconds=?, ends_at=?, updated_at=? WHERE id=?', next.status, next.remaining_seconds, next.ends_at, next.updated_at, next.id);
    setActive(next); setEssayDraft(next.essay_text || ''); setShowEssay(false); setSecondsLeft(remaining); setView('room'); await refreshSessions();
  };

  const pauseSession = async () => {
    if (!active) return;
    const current = activeRef.current;
    if (!current) return;
    const remaining = Math.max(0, Math.ceil((current.ends_at - Date.now()) / 1000));
    await updateSession({ status: 'paused', remaining_seconds: remaining, ends_at: null, essay_text: essayDraft });
    activeRef.current = null;
    setActive(null); setView('hub');
  };

  const finishSession = async (automatic = false) => {
    const current = activeRef.current;
    if (!current || current.status === 'completed') return;
    const now = Date.now();
    const remaining = automatic ? 0 : Math.max(0, Math.ceil((current.ends_at - now) / 1000));
    const resultSnapshot = { ...current, status: 'completed', remaining_seconds: remaining, ends_at: null, completed_at: now, essay_text: essayDraft };
    setLastResult(resultSnapshot);
    await updateSession({ status: 'completed', remaining_seconds: remaining, ends_at: null, completed_at: now, essay_text: essayDraft });
    activeRef.current = null;
    setActive(null); setView('result');
    if (automatic) Alert.alert('Tempo encerrado', 'O tempo da sua prova chegou ao fim. Confira o resultado.');
  };

  const saveAnswer = async (questionId, optionIndex) => {
    const answers = { ...active.answers, [questionId]: optionIndex };
    await updateSession({ answers });
  };
  const toggleMarked = async (questionId) => {
    const marked = active.marked.includes(questionId) ? active.marked.filter((id) => id !== questionId) : [...active.marked, questionId];
    await updateSession({ marked });
  };
  const changeIndex = async (index) => updateSession({ current_index: Math.max(0, Math.min(active.questions.length - 1, index)) });

  const currentQuestion = active?.questions[active.current_index];
  const answeredCount = active ? Object.keys(active.answers).length : 0;
  const correctCount = active?.mode === 'bank' ? active.questions.filter((q) => active.answers[q.id] === q.answer).length : 0;
  const completedSessions = sessions.filter((item) => item.status === 'completed');

  const openSetup = (exam) => { setSelectedExam(exam); setSelectedDay(exam.days[0]); setView('setup'); };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.paper} />
      <View style={s.header}>
        <Pressable onPress={view === 'hub' ? onClose : () => { setActive(null); setView('hub'); }} style={s.back}><Text style={s.backText}>‹</Text></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>Bloco <Text style={s.headerSub}>· Central de provas</Text></Text>
          <Text style={s.headerCaption}>Seu espaço de preparação</Text>
        </View>
        <Tag>{completedSessions.length} concluídas</Tag>
      </View>

      {view === 'hub' && (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.introCard}>
            <Text style={s.kicker}>AMBIENTE DE ESTUDOS</Text>
            <Text style={s.title}>Prepare-se no seu ritmo.</Text>
            <Text style={s.body}>Escolha um exame, faça simulados ou importe um caderno em PDF. Suas sessões ficam salvas neste aparelho.</Text>
            <View style={s.statsRow}><View><Text style={s.statNumber}>{sessions.length}</Text><Text style={s.statLabel}>sessões</Text></View><View><Text style={s.statNumber}>{completedSessions.length}</Text><Text style={s.statLabel}>finalizadas</Text></View><View><Text style={s.statNumber}>{sessions.filter((x) => x.status === 'paused' || x.status === 'running').length}</Text><Text style={s.statLabel}>em andamento</Text></View></View>
          </View>

          <Text style={s.sectionTitle}>Escolha sua prova</Text>
          <Text style={s.sectionHint}>Cada exame tem uma estrutura e um tempo de referência.</Text>
          {EXAMS.map((exam) => (
            <Pressable key={exam.id} onPress={() => openSetup(exam)} style={({ pressed }) => [s.examCard, pressed && { opacity: 0.78 }]}>
              <View style={s.examCardTop}><Tag>{exam.id === 'concursos' ? 'EDITÁVEL' : 'VESTIBULAR'}</Tag><Text style={s.arrow}>↗</Text></View>
              <Text style={s.examName}>{exam.name}</Text><Text style={s.examSubtitle}>{exam.subtitle}</Text><Text style={s.examDescription}>{exam.description}</Text>
            </Pressable>
          ))}

          <View style={s.sectionHeaderRow}><Text style={s.sectionTitle}>Minhas provas</Text><Text style={s.sectionHint}>{sessions.length} sessões</Text></View>
          {sessions.length === 0 ? <View style={s.empty}><Text style={s.emptyTitle}>Seu histórico começa aqui</Text><Text style={s.body}>Quando você iniciar uma prova, poderá pausá-la e voltar depois.</Text></View> : sessions.map((session) => (
            <View key={session.id} style={s.sessionCard}>
              <View style={{ flex: 1 }}><Text style={s.sessionName}>{session.exam_name} · {session.day_name}</Text><Text style={s.sessionMeta}>{session.mode === 'pdf' ? session.source_name || 'Caderno PDF' : 'Banco de questões'} · {session.questions.length} questões</Text><Text style={s.sessionStatus}>{session.status === 'paused' ? 'Pausada' : session.status === 'running' ? 'Em andamento' : 'Concluída'}</Text></View>
              {session.status !== 'completed' ? <Button title="Continuar" onPress={() => resumeSession(session)} /> : <Text style={s.completedMark}>✓</Text>}
            </View>
          ))}
          <Text style={s.disclaimer}>O banco inicial contém questões autorais de demonstração, não questões oficiais. Para resolver provas oficiais, importe seu próprio caderno em PDF.</Text>
        </ScrollView>
      )}

      {view === 'setup' && (
        <ScrollView contentContainerStyle={s.content}>
          <Tag>CONFIGURAR SESSÃO</Tag>
          <Text style={s.title}>{selectedExam.name}</Text><Text style={s.body}>{selectedExam.description}</Text>
          <Text style={s.sectionTitle}>Etapa da prova</Text>
          {selectedExam.days.map((day) => <Pressable key={day.id} onPress={() => setSelectedDay(day)} style={[s.dayOption, selectedDay.id === day.id && s.dayOptionSelected]}><View style={{ flex: 1 }}><Text style={s.dayName}>{day.name}</Text><Text style={s.sessionMeta}>{day.questions} questões · {Math.floor(day.minutes / 60)}h{String(day.minutes % 60).padStart(2, '0')}</Text></View><Text style={s.radio}>{selectedDay.id === day.id ? '●' : '○'}</Text></Pressable>)}
          <Text style={s.sectionTitle}>Como deseja fazer?</Text>
          <View style={s.modeCard}><Text style={s.modeTitle}>Banco de questões</Text><Text style={s.body}>Questões de treino com alternativas, gabarito e explicação. Sessão demonstrativa de 30 minutos.</Text><Button title="Começar treino" onPress={() => createSession({ mode: 'bank' })} /></View>
          <View style={s.modeCard}><Text style={s.modeTitle}>Importar prova oficial (PDF)</Text><Text style={s.body}>Importe seu caderno, consulte-o durante a prova e marque as respostas na folha digital. O tempo segue a etapa selecionada.</Text><Button title={busy ? 'Abrindo arquivos…' : 'Selecionar PDF e iniciar'} onPress={importPdf} disabled={busy} secondary /></View>
          <Text style={s.disclaimer}>A importação mantém o arquivo selecionado como referência. Nesta versão, o PDF é aberto no leitor do aparelho; o Bloco registra as respostas e o tempo, mas ainda não extrai automaticamente o texto das páginas nem corrige o gabarito oficial.</Text>
        </ScrollView>
      )}

      {view === 'room' && active && currentQuestion && (
        <View style={s.room}>
          <View style={s.timerBar}><View><Text style={s.timerCaption}>{active.exam_name} · {active.day_name}</Text><Text style={[s.timer, secondsLeft < 300 && { color: C.red }]}>{formatTime(secondsLeft)}</Text></View><View style={{ alignItems: 'flex-end' }}><Text style={s.timerCaption}>PROGRESSO</Text><Text style={s.progressText}>{answeredCount}/{active.questions.length} respondidas</Text></View></View>
          <View style={s.progressTrack}><View style={[s.progressFill, { width: `${(active.current_index + 1) / active.questions.length * 100}%` }]} /></View>
          <View style={s.roomActions}>
            {active.mode === 'pdf' && <Button title="Abrir caderno PDF" secondary onPress={() => Linking.openURL(active.source_uri).catch(() => Alert.alert('Não foi possível abrir o PDF', 'Tente abrir o arquivo pelo gerenciador de documentos do aparelho.'))} />}
            {((active.exam_id === 'enem' && active.day_name.startsWith('1º dia')) || (active.exam_id === 'urca' && active.day_name.startsWith('2º dia')) || (active.exam_id === 'uece' && active.day_name.includes('1º dia'))) && <Button title={showEssay ? 'Voltar às questões' : 'Redação'} secondary onPress={async () => { await updateSession({ essay_text: essayDraft }); setShowEssay((value) => !value); }} />}
            <Button title="Pausar e sair" secondary onPress={pauseSession} />
          </View>
          <ScrollView contentContainerStyle={s.questionScroll}>
            {showEssay ? (
              <View>
                <Tag>REDAÇÃO ENEM</Tag>
                <Text style={s.questionPrompt}>Desenvolva seu texto dissertativo-argumentativo.</Text>
                <Text style={s.body}>O espaço abaixo salva seu rascunho nesta sessão. A avaliação pelas cinco competências poderá ser adicionada em uma etapa futura.</Text>
                <TextInput multiline textAlignVertical="top" value={essayDraft} onChangeText={setEssayDraft} onEndEditing={() => updateSession({ essay_text: essayDraft })} placeholder="Comece a escrever sua redação..." style={s.essayInput} />
                <Text style={s.sessionMeta}>{essayDraft.trim().split(/\\s+/).filter(Boolean).length} palavras · {essayDraft.length} caracteres</Text>
              </View>
            ) : (
            <>
            <View style={s.questionTop}><Tag>{currentQuestion.subject || 'Questão'}</Tag><Text style={s.questionNumber}>QUESTÃO {active.current_index + 1} DE {active.questions.length}</Text></View>
            <Text style={s.questionPrompt}>{currentQuestion.prompt}</Text>
            {currentQuestion.options.map((option, index) => {
              const selected = active.answers[currentQuestion.id] === index;
              return <Pressable key={index} onPress={() => saveAnswer(currentQuestion.id, index)} style={[s.option, selected && s.optionSelected]}><View style={[s.optionLetter, selected && s.optionLetterSelected]}><Text style={[s.optionLetterText, selected && { color: C.white }]}>{String.fromCharCode(65 + index)}</Text></View><Text style={[s.optionText, selected && { color: C.ink, fontWeight: '700' }]}>{active.mode === 'pdf' ? option : option}</Text></Pressable>;
            })}
            {active.mode === 'bank' && active.answers[currentQuestion.id] !== undefined && <View style={s.explanation}><Text style={s.explanationTitle}>Resposta registrada</Text><Text style={s.body}>A explicação ficará disponível após finalizar a sessão.</Text></View>}
            <Pressable onPress={() => toggleMarked(currentQuestion.id)} style={s.markButton}><Text style={s.markText}>{active.marked.includes(currentQuestion.id) ? '★ Marcada para revisar' : '☆ Marcar para revisar'}</Text></Pressable>
            </>
            )}
          </ScrollView>
          <View style={s.navigation}><Button title="Anterior" secondary disabled={active.current_index === 0} onPress={() => changeIndex(active.current_index - 1)} /><Text style={s.navCount}>{active.current_index + 1} / {active.questions.length}</Text>{active.current_index === active.questions.length - 1 ? <Button title="Finalizar" onPress={() => Alert.alert('Finalizar prova?', 'Suas respostas serão registradas e a sessão será encerrada.', [{ text: 'Continuar', style: 'cancel' }, { text: 'Finalizar', style: 'destructive', onPress: () => finishSession(false) }])} /> : <Button title="Próxima" onPress={() => changeIndex(active.current_index + 1)} />}</View>
        </View>
      )}

      {view === 'result' && (
        <View style={s.resultWrap}>
          <Text style={s.kicker}>SESSÃO FINALIZADA</Text>
          <Text style={s.title}>Bom trabalho!</Text>
          <Text style={s.body}>Sua sessão foi salva no histórico do Bloco.</Text>
          <View style={s.resultCard}>
            {lastResult?.mode === 'bank' ? (
              <>
                <Text style={s.resultBig}>{lastResult.questions.filter((q) => lastResult.answers[q.id] === q.answer).length}/{lastResult.questions.length}</Text>
                <Text style={s.body}>acertos no banco de questões</Text>
              </>
            ) : (
              <>
                <Text style={s.resultBig}>{Object.keys(lastResult?.answers || {}).length}</Text>
                <Text style={s.body}>respostas registradas no caderno importado</Text>
              </>
            )}
          </View>
          {lastResult?.mode === 'bank' && lastResult.questions.map((question, index) => (
            <View key={question.id} style={s.reviewItem}>
              <Text style={s.reviewTitle}>Questão {index + 1} · {lastResult.answers[question.id] === question.answer ? 'Acertou' : 'Revisar'}</Text>
              <Text style={s.body}>Gabarito: {String.fromCharCode(65 + question.answer)} · {question.explanation}</Text>
            </View>
          ))}
          <Button title="Voltar à central de provas" onPress={() => { setView('hub'); refreshSessions(); }} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line, gap: 10 },
  back: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center' }, backText: { fontSize: 28, color: C.ink, lineHeight: 32, marginTop: -3 },
  brand: { fontSize: 20, fontFamily: 'serif', fontStyle: 'italic', color: C.ink }, headerSub: { fontSize: 12, fontFamily: 'sans-serif', fontStyle: 'normal' }, headerCaption: { fontSize: 10, color: C.muted, marginTop: 2 },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  introCard: { backgroundColor: C.ink, borderRadius: 22, padding: 22, marginBottom: 10 }, kicker: { color: '#B9D0BF', fontSize: 9, letterSpacing: 1.6, fontWeight: '800' }, title: { fontSize: 28, lineHeight: 34, color: C.ink, fontFamily: 'serif', marginTop: 8 }, introCardTitle: { color: C.white }, body: { color: C.muted, fontSize: 12, lineHeight: 19, marginTop: 6 }, statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#526B5C' }, statNumber: { color: C.white, fontSize: 21, fontWeight: '700' }, statLabel: { color: '#B9C9BC', fontSize: 9, marginTop: 2 },
  sectionTitle: { color: C.ink, fontSize: 19, fontFamily: 'serif', marginTop: 8 }, sectionHint: { color: C.muted, fontSize: 10, marginTop: -7 },
  examCard: { backgroundColor: C.white, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 17, gap: 5 }, examCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, tag: { backgroundColor: C.pale, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, alignSelf: 'flex-start' }, tagText: { color: C.green, fontSize: 8, fontWeight: '800', letterSpacing: 0.7 }, arrow: { color: C.green, fontSize: 18 }, examName: { color: C.ink, fontSize: 22, fontFamily: 'serif', marginTop: 4 }, examSubtitle: { color: C.green, fontSize: 10, fontWeight: '700' }, examDescription: { color: C.muted, fontSize: 11, lineHeight: 16 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }, empty: { backgroundColor: C.white, borderRadius: 16, padding: 20, alignItems: 'center' }, emptyTitle: { color: C.ink, fontSize: 15, fontWeight: '700' },
  sessionCard: { backgroundColor: C.white, borderRadius: 15, borderWidth: 1, borderColor: C.line, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, sessionName: { color: C.ink, fontSize: 12, fontWeight: '700' }, sessionMeta: { color: C.muted, fontSize: 9, marginTop: 4 }, sessionStatus: { color: C.green, fontSize: 9, fontWeight: '700', marginTop: 5 }, completedMark: { color: C.green, fontSize: 22, fontWeight: '700', paddingHorizontal: 12 },
  disclaimer: { color: C.muted, fontSize: 9, lineHeight: 15, marginTop: 6 },
  dayOption: { flexDirection: 'row', alignItems: 'center', padding: 14, borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.white }, dayOptionSelected: { borderColor: C.green, backgroundColor: '#F0F5F0' }, dayName: { color: C.ink, fontSize: 11, fontWeight: '700' }, radio: { color: C.green, fontSize: 18, marginLeft: 10 },
  modeCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 17, padding: 16, gap: 8 }, modeTitle: { color: C.ink, fontSize: 15, fontWeight: '700' },
  button: { backgroundColor: C.ink, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' }, buttonSecondary: { backgroundColor: C.pale }, buttonDanger: { backgroundColor: '#FBEFED' }, buttonText: { color: C.white, fontSize: 10, fontWeight: '800' }, buttonTextSecondary: { color: C.green }, buttonTextDanger: { color: C.red },
  room: { flex: 1 }, timerBar: { backgroundColor: C.white, paddingHorizontal: 20, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, timerCaption: { color: C.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1 }, timer: { color: C.ink, fontSize: 25, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 2 }, progressText: { color: C.green, fontSize: 11, fontWeight: '700', marginTop: 5 }, progressTrack: { height: 4, backgroundColor: C.line }, progressFill: { height: 4, backgroundColor: C.green }, roomActions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, gap: 10 }, questionScroll: { padding: 18, paddingBottom: 25 }, questionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, questionNumber: { color: C.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 }, questionPrompt: { color: C.ink, fontSize: 17, lineHeight: 25, fontWeight: '600', marginTop: 20, marginBottom: 18 }, option: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, marginBottom: 9, gap: 11 }, optionSelected: { borderColor: C.green, backgroundColor: '#F0F5F0' }, optionLetter: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F0F1EC', alignItems: 'center', justifyContent: 'center' }, optionLetterSelected: { backgroundColor: C.green }, optionLetterText: { color: C.green, fontSize: 10, fontWeight: '800' }, optionText: { color: '#59675E', fontSize: 11, lineHeight: 17, flex: 1 }, explanation: { backgroundColor: C.pale, padding: 12, borderRadius: 12, marginTop: 8 }, explanationTitle: { color: C.green, fontSize: 11, fontWeight: '800' }, markButton: { paddingVertical: 12 }, markText: { color: C.amber, fontSize: 11, fontWeight: '700' }, navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 13, backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.line }, navCount: { color: C.muted, fontSize: 10, fontWeight: '700' },
  resultWrap: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'stretch' }, resultCard: { backgroundColor: C.white, borderRadius: 18, padding: 24, alignItems: 'center', marginVertical: 24 }, resultBig: { color: C.green, fontSize: 42, fontWeight: '800' },
  essayInput: { minHeight: 300, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, color: C.ink, fontSize: 13, lineHeight: 21, marginTop: 14 },
  reviewItem: { backgroundColor: C.white, borderRadius: 12, padding: 12, marginBottom: 8 }, reviewTitle: { color: C.green, fontSize: 11, fontWeight: '800' }
});
