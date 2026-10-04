import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { joinRoom, type Controller } from './controller';
import { GAME_URL, parseRoom, type Hud, type Point } from './protocol';
import { useSword } from './useSword';

import StartGame from './StartGame';
const feedback = () => { void Haptics.selectionAsync().catch(() => {}); };
type Phase = 'home' | 'creating' | 'joining' | 'ready' | 'playing';

function Button({ title, onPress, secondary = false, disabled = false, testID }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean; testID?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} testID={testID} onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (pressed || disabled) && { opacity: .55 }]}>
    <Text style={[styles.buttonText, secondary && { color: '#f0f4fa' }]}>{title}</Text>
  </Pressable>;
}
function Awake() { useKeepAwake(undefined, { suppressDeactivateWarnings: true }); return null; }

export default function SliceParty() {
  const params = useLocalSearchParams<{ room?: string }>();
  const [phase, setPhase] = useState<Phase>('home');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [scanner, setScanner] = useState(false);
  const [permission, requestCamera] = useCameraPermissions();
  const [hud, setHud] = useState<Hud>({});
  const [status, setStatus] = useState('lobby');
  const [mode, setMode] = useState<'motion' | 'touch'>('motion');
  const [busy, setBusy] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [tip, setTip] = useState<Point>({ x: .5, y: .5 });
  const controller = useRef<Controller | null>(null);
  const attempt = useRef<AbortController | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanLock = useRef(false);
  const alive = useRef(true);
  const pad = useRef({ width: 1, height: 1 });
  const paintAt = useRef(0);

  const disconnect = useCallback(() => {
    attempt.current?.abort(); attempt.current = null;
    controller.current?.destroy(); controller.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
  }, []);
  const send = useCallback((point: Point) => {
    controller.current?.send(point);
    if (performance.now() - paintAt.current > 60) {
      paintAt.current = performance.now(); setTip(point);
    }
  }, []);
  const unavailable = useCallback(() => {
    setMode('touch'); setNote('Motion is unavailable. Drag on the pad, or enable Motion in iPhone Settings.');
  }, []);
  const { enable, center } = useSword(foreground && phase === 'playing' && mode === 'motion', send, unavailable);

  const connect = useCallback(async (input: string) => {
    let room: string;
    try { room = parseRoom(input); } catch (e) { setError((e as Error).message); return; }
    disconnect(); setScanner(false); setCode(room); setError(''); setNote(''); setHud({}); setStatus('lobby'); setPhase('joining');
    const abort = new AbortController(); attempt.current = abort;
    const current = () => alive.current && attempt.current === abort && !abort.signal.aborted;
    timeout.current = setTimeout(() => {
      if (!current()) return;
      disconnect(); setPhase('home'); setError('The connection timed out. Check your internet and try again.');
    }, 15000);
    try {
      const joined = await joinRoom(room, {
        onHud: data => { if (current()) setHud(data); },
        onStatus: value => { if (current()) setStatus(value); },
        onClosed: reason => {
          if (!current()) return;
          disconnect(); setPhase('home'); setError(reason);
        },
      }, abort.signal);
      if (!current()) { joined.destroy(); return; }
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = null; controller.current = joined; setPhase('ready'); feedback();
    } catch (e) {
      if (!current()) return;
      disconnect(); setPhase('home'); setError((e as Error).message);
    }
  }, [disconnect]);

  useEffect(() => {
    if (!params.room) return;
    const room = params.room;
    const timer = setTimeout(() => { void connect(room); }, 0);
    return () => clearTimeout(timer);
  }, [params.room, connect]);
  useEffect(() => {
    alive.current = true;
    const subscription = AppState.addEventListener('change', next => {
      setForeground(next === 'active');
      // iOS permission dialogs use "inactive"; only release on background.
      if (next === 'background' && attempt.current) {
        disconnect(); setPhase('home'); setScanner(false);
        setNote('Welcome back. Rejoin the room to pick up your sword.');
      }
    });
    return () => { alive.current = false; subscription.remove(); disconnect(); };
  }, [disconnect]);

  async function start() {
    const session = controller.current;
    if (!session || busy) return;
    setBusy(true); setNote('');
    try {
      if (mode === 'motion') {
        const granted = await enable();
        if (!granted) { setMode('touch'); setNote('Motion access is off. Drag to swing, or enable Motion in iPhone Settings.'); }
      }
      if (!alive.current || controller.current !== session) return;
      center(); setPhase('playing');
      if (status !== 'playing') session.command(status === 'over' ? 'again' : 'start');
      feedback();
    } finally { if (alive.current) setBusy(false); }
  }
  async function enableMotion() {
    const session = controller.current;
    if (!session || busy) return;
    setBusy(true);
    try {
      const granted = await enable();
      if (!alive.current || session !== controller.current) return;
      if (granted) { setMode('motion'); setNote(''); center(); feedback(); }
      else setNote('Motion access is off. Enable Motion in iPhone Settings, or use touch.');
    } finally { if (alive.current) setBusy(false); }
  }
  async function scan() {
    setError('');
    try {
      const granted = permission?.granted || (await requestCamera()).granted;
      if (!granted) { setError('Camera access is off. Enter the room code instead, or enable Camera in iPhone Settings.'); return; }
      scanLock.current = false; setScanner(true);
    } catch { setError('Could not open the camera. Enter the room code instead.'); }
  }
  const touch = (event: GestureResponderEvent) => {
    if (mode !== 'touch') return;
    event.preventDefault();
    const point = { x: Math.max(0, Math.min(1, event.nativeEvent.locationX / pad.current.width)), y: Math.max(0, Math.min(1, event.nativeEvent.locationY / pad.current.height)) };
    send(point); setTip(point);
  };
  const leave = () => { disconnect(); setPhase('home'); setHud({}); setError(''); setNote(''); };
  const connected = phase === 'ready' || phase === 'playing';
  const lives = Math.max(0, Math.min(3, hud.lives ?? 3));
  const over = status === 'over';

  return <SafeAreaView style={styles.root}>
    <StatusBar style="light" />
    {connected && foreground && <Awake />}
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={phase !== 'playing'}>
        <View style={styles.header}>
          <Text style={styles.brand}>SLICE PARTY</Text>
          {connected && <Pressable accessibilityRole="button" onPress={leave} hitSlop={12}><Text style={styles.leave}>Leave</Text></Pressable>}
        </View>
        {phase === 'creating' ? <StartGame foreground={foreground} onConnect={connect} onJoin={() => setPhase('home')} onBack={leave} /> : !connected ? <>
          <LinearGradient colors={['#1d3933', '#102323']} style={styles.hero}>
            <Text style={styles.fruits}>🍉  🍊  🍓</Text><View style={styles.slash} />
            <Text style={styles.heroCaption}>YOUR PHONE IS THE SWORD.</Text>
          </LinearGradient>
          <Text style={styles.title}>Swing big.{ '\n' }Slice everything.</Text>
          <Text style={styles.description}>Fruit on the big screen. The sword in your hand. Connect your iPhone and make every swing count.</Text>
          <View style={styles.steps}>
            <Text style={styles.step}>01  Open the game on a computer or TV.</Text>
            <Text style={styles.step}>02  Scan its QR code or enter the room code.</Text>
            <Text style={styles.step}>03  Point, center, and swing.</Text>
          </View>
          {phase === 'joining' ? <View style={styles.joining}><ActivityIndicator color="#d8fc65" /><Text style={styles.description}>Connecting your sword…</Text><Button title="Cancel" secondary onPress={leave} /></View> : <>
            <Button title="Create a room" testID="new-room" onPress={() => { setError(''); setNote(''); setPhase('creating'); }} />
            <Button secondary title="Scan game QR" testID="scan" onPress={() => { void scan(); }} />
            <View style={styles.joinRow}>
              <TextInput testID="room-code" accessibilityLabel="Six-digit room code" value={code} onChangeText={setCode} placeholder="Room code" placeholderTextColor="#737e8d" keyboardType="number-pad" maxLength={6} style={styles.input} onSubmitEditing={() => { void connect(code); }} />
              <View style={styles.joinButton}><Button title="Join" testID="join" disabled={!/^\d{6}$/.test(code)} onPress={() => { void connect(code); }} /></View>
            </View>
            {GAME_URL !== '' && <Button title="Share game link for the big screen" secondary onPress={() => { void Share.share({ message: GAME_URL }).catch(() => setError('Could not share the link.')); }} />}
          </>}
        </> : <>
          <View style={styles.roomRow}><View style={styles.dot} /><Text style={styles.room}>ROOM {code} · SWORD CONNECTED</Text></View>
          <View style={styles.scoreRow}>
            <View><Text style={styles.label}>SCORE</Text><Text style={styles.score}>{hud.score ?? 0}</Text></View>
            <View style={styles.stats}><Text style={styles.best}>BEST {hud.best ?? 0}</Text><Text accessibilityLabel={`${lives} lives remaining`} style={styles.hearts}>{'♥'.repeat(lives)}<Text style={styles.spent}>{'♥'.repeat(3 - lives)}</Text></Text>{(hud.combo ?? 0) > 1 && <Text style={styles.combo}>COMBO ×{hud.combo}</Text>}</View>
          </View>
          {phase === 'ready' ? <>
            <Text style={styles.title}>Sword ready.</Text>
            <Text style={styles.description}>Point your phone toward the screen, tilted back so you can see its display. Start while aiming at the middle.</Text>
            <View style={styles.modeRow}>
              <Button title="Motion sword" secondary={mode !== 'motion'} onPress={() => setMode('motion')} />
              <Button title="Touch sword" secondary={mode !== 'touch'} onPress={() => setMode('touch')} />
            </View>
            <Button title={busy ? 'Enabling motion…' : status === 'playing' ? 'Join run' : 'Start game'} testID="start" disabled={busy} onPress={() => { void start(); }} />
          </> : <>
            <View style={styles.pad} testID="sword-pad" onLayout={e => { pad.current = e.nativeEvent.layout; }}
              onStartShouldSetResponder={() => mode === 'touch'} onMoveShouldSetResponder={() => mode === 'touch'} onResponderGrant={touch} onResponderMove={touch} onResponderRelease={touch} onResponderTerminationRequest={() => false}>
              <View pointerEvents="none">
              <Text style={styles.mode}>{mode === 'motion' ? 'MOTION SWORD' : 'TOUCH SWORD'}</Text>
              <Text style={styles.padTitle}>{over ? 'Nice slicing.' : mode === 'motion' ? 'Swing to slice.' : 'Drag to slice.'}</Text>
              <Text style={styles.padHint}>{over ? 'Ready for another round?' : 'Watch the big screen.'}</Text>
              </View>
              {mode === 'touch' && <View pointerEvents="none" style={[styles.tip, { left: `${tip.x * 100}%`, top: `${tip.y * 100}%` }]} />}
            </View>
            <View style={styles.modeRow}>
              <Button title="Center sword" secondary onPress={() => { center(); controller.current?.command('center'); feedback(); setNote('Sword centered. Aim at the middle and swing.'); }} />
              <Button title={mode === 'motion' ? 'Use touch' : 'Use motion'} secondary disabled={busy} onPress={() => { if (mode === 'motion') { setMode('touch'); setNote(''); } else void enableMotion(); }} />
            </View>
            {over && <Button title="Play again" testID="again" onPress={() => { center(); controller.current?.command('again'); feedback(); }} />}
            <Text style={styles.rules}>Three lives. Slice fruit. Avoid bombs.</Text>
          </>}
        </>}
        {!!note && <Text accessibilityLiveRegion="polite" style={styles.note}>{note}</Text>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {!connected && <View style={styles.modeRow}>
          <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(GAME_URL + 'support.html').catch(() => setError('Could not open support.')); }}><Text style={styles.leave}>Help and support</Text></Pressable>
          <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(GAME_URL + 'privacy.html').catch(() => setError('Could not open privacy policy.')); }}><Text style={styles.leave}>Privacy policy</Text></Pressable>
        </View>}
      </ScrollView>
    </KeyboardAvoidingView>
    <Modal visible={scanner} animationType="slide" onRequestClose={() => setScanner(false)}>
      <SafeAreaView style={styles.root}>
        <View style={styles.scanHeader}><Text style={styles.brand}>SCAN THE GAME QR</Text><Button title="Close" secondary onPress={() => setScanner(false)} /></View>
        {scanner && permission?.granted && <CameraView style={styles.flex} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => {
          if (scanLock.current) return;
          scanLock.current = true;
          try { const room = parseRoom(data); void connect(room); } catch (e) { setScanner(false); setError((e as Error).message); }
        }} />}
        <Text style={styles.scanHint}>Point your camera at the QR code on the computer or TV.</Text>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#090d13' }, flex: { flex: 1 },
  content: { padding: 24, gap: 20, flexGrow: 1, maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  brand: { color: '#d8fc65', fontWeight: '900', fontSize: 14, letterSpacing: 3 }, leave: { color: '#aab4c2', fontSize: 15, fontWeight: '600' },
  hero: { height: 160, borderRadius: 28, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fruits: { fontSize: 47, letterSpacing: 6 }, slash: { height: 5, width: 220, position: 'absolute', backgroundColor: '#eaffb0', borderRadius: 8, transform: [{ rotate: '-28deg' }] },
  heroCaption: { color: '#b5cec0', fontWeight: '800', letterSpacing: 2, fontSize: 10, marginTop: 25 },
  title: { color: '#f0f4fa', fontWeight: '900', fontSize: 38, lineHeight: 42, letterSpacing: -1.4 },
  description: { color: '#aab4c2', fontSize: 16, lineHeight: 25 }, steps: { gap: 12, marginVertical: 4 }, step: { color: '#c1cbd5', fontSize: 14, lineHeight: 20 },
  button: { borderRadius: 18, paddingVertical: 19, paddingHorizontal: 18, backgroundColor: '#d8fc65', alignItems: 'center', justifyContent: 'center', minHeight: 56 },
  secondary: { backgroundColor: '#1b232e', borderWidth: 1, borderColor: '#2c3745' }, buttonText: { fontSize: 16, fontWeight: '800', color: '#162108', textAlign: 'center' },
  joining: { gap: 20 }, joinRow: { flexDirection: 'row', gap: 12 }, joinButton: { width: 96 }, input: { flex: 1, borderRadius: 18, backgroundColor: '#131a24', borderWidth: 1, borderColor: '#2c3745', color: '#f0f4fa', fontSize: 21, letterSpacing: 4, paddingHorizontal: 18, minHeight: 60 },
  note: { color: '#d8fc65', fontSize: 14, lineHeight: 22 }, error: { color: '#ff8f88', fontSize: 14, lineHeight: 22 },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#84e2a5' }, room: { color: '#9cb8ac', fontWeight: '700', letterSpacing: 1, fontSize: 11 },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8 }, label: { color: '#737e8d', fontWeight: '800', fontSize: 11, letterSpacing: 3 },
  score: { color: '#f0f4fa', fontSize: 76, fontWeight: '900', lineHeight: 88, fontVariant: ['tabular-nums'] }, stats: { alignItems: 'flex-end', gap: 6 }, best: { color: '#aab4c2', fontSize: 12, fontWeight: '700' },
  hearts: { color: '#ff7279', fontSize: 24, letterSpacing: 5 }, spent: { color: '#343e4a' }, combo: { color: '#d8fc65', fontSize: 12, fontWeight: '800' },
  modeRow: { flexDirection: 'row', gap: 10 }, pad: { minHeight: 240, flex: 1, backgroundColor: '#10251f', borderWidth: 1, borderColor: '#29433a', borderRadius: 28, padding: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mode: { color: '#91ad9e', fontSize: 10, fontWeight: '800', letterSpacing: 3, marginBottom: 20 }, padTitle: { color: '#e6f3de', fontSize: 29, fontWeight: '800', textAlign: 'center' }, padHint: { color: '#9cb8ac', fontSize: 15, marginTop: 8, textAlign: 'center' },
  tip: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#eaffb0', marginLeft: -9, marginTop: -9 }, rules: { textAlign: 'center', color: '#737e8d', fontSize: 12 },
  scanHeader: { padding: 20, gap: 16 }, scanHint: { color: '#aab4c2', textAlign: 'center', padding: 24, fontSize: 15, lineHeight: 22 },
});
