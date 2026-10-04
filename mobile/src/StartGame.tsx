import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { randomUUID } from 'expo-crypto';
import { GAME_URL } from './protocol';
import { reserveScreen, type Launch } from './launch';

function Action({ title, onPress, disabled = false, primary = false, testID }: { title: string; onPress: () => void; disabled?: boolean; primary?: boolean; testID?: string }) {
  return <Pressable accessibilityRole="button" testID={testID} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, primary && styles.primary, (pressed || disabled) && { opacity: .5 }]}>
    <Text style={[styles.buttonText, primary && { color: '#162108' }]}>{title}</Text>
  </Pressable>;
}

export default function StartGame({ foreground, onConnect, onJoin, onBack }: { foreground: boolean; onConnect: (code: string) => void; onJoin: () => void; onBack: () => void }) {
  const [ticket, setTicket] = useState<Launch | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [guide, setGuide] = useState<'tv' | 'hdmi' | 'airplay' | null>(null);
  const request = useRef<AbortController | null>(null);
  const currentTicket = useRef<Launch | null>(null);
  const connecting = useRef(false);

  useEffect(() => () => {
    request.current?.abort();
    void currentTicket.current?.cancel().catch(() => {});
  }, []);
  useEffect(() => {
    if (!ticket) return;
    let claimed = false;
    const off = ticket.watch(() => { claimed = true; setReady(true); setError(''); }, message => { setReady(false); setError(message); });
    const timer = setTimeout(() => {
      if (claimed) return;
      setError('This link expired. Create a new link below.');
      void ticket.cancel().catch(() => {});
    }, Math.max(0, ticket.expiresAt - Date.now()));
    return () => { off(); clearTimeout(timer); };
  }, [ticket]);
  useEffect(() => {
    if (!ready || !foreground || !ticket || connecting.current) return;
    connecting.current = true;
    onConnect(ticket.code);
  }, [ready, foreground, ticket, onConnect]);

  async function prepare() {
    request.current?.abort();
    void currentTicket.current?.cancel().catch(() => {});
    currentTicket.current = null; setTicket(null); setReady(false); setError(''); setNotice(''); setBusy(true);
    const abort = new AbortController(); request.current = abort;
    const timeout = setTimeout(() => { abort.abort(); setBusy(false); setError('Could not create a link. Check your internet and try again.'); }, 15000);
    abort.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
    try {
      const next = await reserveScreen(randomUUID().replace(/-/g, ''), abort.signal);
      if (abort.signal.aborted) { void next.cancel().catch(() => {}); return; }
      currentTicket.current = next; setTicket(next);
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { clearTimeout(timeout); if (request.current === abort && !abort.signal.aborted) setBusy(false); }
  }
  async function share(url: string) {
    setNotice('');
    try {
      await Share.share(Platform.OS === 'ios'
        ? { title: 'Play Slice Party', message: 'Open on your computer or TV to play Slice Party.', url }
        : { title: 'Play Slice Party', message: `Open on your computer or TV to play Slice Party.\n${url}` });
    } catch { setNotice('Sharing is unavailable here. Use Copy link instead.'); }
  }
  async function copy(url: string) {
    try {
      const copied = await Clipboard.setStringAsync(url);
      setNotice(copied ? 'Link copied. Paste it on your other device.' : 'Select the address below to copy it.');
    } catch { setNotice('Select the address below to copy it.'); }
  }

  return <View style={styles.content}>
    <Action title="Back" onPress={onBack} />
    <Text accessibilityRole="header" style={styles.title}>Create a room</Text>
    <Text style={styles.description}>Choose how to open the game on another screen. Your iPhone stays your sword.</Text>
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.status}>{notice}</Text>}

    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Send to a computer</Text>
      <Text style={styles.description}>Send a game link by Messages, email, or AirDrop to a nearby Mac. Open it on the other device, then choose Open game on this screen.</Text>
      {!ticket ? <Action title={busy ? 'Creating your link…' : 'Create room link'} primary disabled={busy} onPress={() => { void prepare(); }} testID="create-game-link" /> : <>
        <Text style={styles.status} accessibilityLiveRegion="polite">{ready ? 'Screen found. Connecting…' : 'Waiting for your screen…'}</Text>
        <Action title="Send game link" primary disabled={!!error} onPress={() => { void share(ticket.url); }} />
        <Action title="Copy game link" disabled={!!error} onPress={() => { void copy(ticket.url); }} />
        <Text selectable testID="game-launch-link" style={styles.address}>{ticket.url}</Text>
        <Text style={styles.hint}>Return here after sharing. Your sword connects automatically when the screen opens. The link expires after 10 minutes and works on one screen.</Text>
        <Action title="Create a new link" disabled={busy} onPress={() => { void prepare(); }} />
      </>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>

    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Open the website yourself</Text>
      <Text style={styles.description}>Type this address in a computer or TV browser, then join by scanning the game QR.</Text>
      <Text selectable testID="game-website" style={styles.address}>{GAME_URL.replace('https://', '')}</Text>
      <Action title="Copy website address" onPress={() => { void copy(GAME_URL); }} />
      <Action title="Share website address" onPress={() => { void share(GAME_URL); }} />
      <Action title="The game is open — join it" primary onPress={onJoin} />
    </View>

    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Play on a TV</Text>
      <Action title="Use a TV web browser" onPress={() => setGuide(guide === 'tv' ? null : 'tv')} />
      {guide === 'tv' && <Text style={styles.description}>1. Open your TV’s web browser.{ '\n' }2. Enter the website address above.{ '\n' }3. Choose “The game is open — join it” here and scan the TV’s QR.{ '\n\n' }If your TV cannot load the game, use a computer connected by HDMI.</Text>}
      <Action title="Connect a computer with HDMI" onPress={() => setGuide(guide === 'hdmi' ? null : 'hdmi')} />
      {guide === 'hdmi' && <Text style={styles.description}>1. Connect your computer to the TV with an HDMI cable or suitable adapter.{ '\n' }2. Select that HDMI input on the TV.{ '\n' }3. Open the game link on the computer and move its browser to the TV screen.{ '\n' }4. Keep this app open to use your iPhone as the sword.</Text>}
      <Action title="Use AirPlay from a Mac" onPress={() => setGuide(guide === 'airplay' ? null : 'airplay')} />
      {guide === 'airplay' && <Text style={styles.description}>1. Connect your Mac and AirPlay-compatible TV to the same Wi-Fi.{ '\n' }2. On the Mac, open Control Center → Screen Mirroring and choose your TV.{ '\n' }3. Open the game link on the Mac. Keep this app on your iPhone to control it.{ '\n\n' }Mirroring this iPhone shows the sword controls. Use the Mac as the game screen.</Text>}
      <Text style={styles.hint}>Click or select the game screen once to enable its sound. TV browser and AirPlay support depend on your devices.</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 18 }, title: { color: '#f0f4fa', fontSize: 32, fontWeight: '800' },
  description: { color: '#aab4c2', fontSize: 14, lineHeight: 22 },
  card: { backgroundColor: '#10251f', borderWidth: 1, borderColor: '#29433a', borderRadius: 22, padding: 20, gap: 14 },
  heading: { color: '#d8fc65', fontSize: 20, fontWeight: '700' },
  button: { minHeight: 50, borderRadius: 14, padding: 14, backgroundColor: '#1b232e', borderWidth: 1, borderColor: '#2c3745', alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#d8fc65', borderColor: '#d8fc65' }, buttonText: { color: '#f0f4fa', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  address: { color: '#b6ddff', fontSize: 13, lineHeight: 21 }, hint: { color: '#a79eb8', fontSize: 12, lineHeight: 19 },
  status: { color: '#a4dfc0', fontSize: 13, lineHeight: 20 }, error: { color: '#ffacb0', fontSize: 13, lineHeight: 20 },
});
