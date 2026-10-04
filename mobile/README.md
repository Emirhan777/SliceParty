# Slice Party for iOS

A native iPhone controller for the Slice Party game on a computer or TV. Scan
the existing game QR code or enter its six-digit room code, choose motion or
touch, and start slicing. Live score, best score, lives, restart, and centering
are available in the app. Two phones can join the same screen.

The app imports `../ninja/tilt.js` directly. This is the same tracker copied from
HarryPotterSpells; native sensor readings are converted from radians to degrees
before being passed to it. Native controls never estimate velocity or predict
the sword position. The game screen remains the existing web game.

## Create a room from the app

Tap **Create a room**, then **Create room link**. Copy or share the link to a
computer or TV browser. Select **Open game on this screen**, then return to the
app to connect automatically. Links expire after ten minutes and can be claimed
by one screen. Cancelling a pending link removes its reservation; leaving the
setup screen after the big screen connects does not delete the active room.

Anyone can also open https://emirhan777.github.io/SliceParty/ to get a separate
room immediately, then scan its QR or type the six-digit code into the app.
Two phones can join each room. The public website stays online without the
local development computer.

## Try it on your iPhone

Install **Expo Go** from the App Store, then from the repository root run:

```powershell
npm --prefix mobile install
npm run ios:tunnel
```

Scan the Expo development QR in your terminal to open Slice Party in Expo Go.
This development QR loads the app; it is different from the game's room QR.

Open the game HTTPS link on the computer. In Slice Party, tap **Scan game QR**
and scan that computer screen, or enter its room code. Choose **Motion sword**
and tap **Start game**. Allow motion, hold the phone tilted back so its display
is visible, and point at the screen. **Center sword** anchors the middle.

`npm run ios` uses your local network instead of an Expo tunnel. Leave the game
server and Expo server running during development. No Expo account or Apple
signing credentials are stored in this repository.

The home screen can share the big-screen game link. Set `EXPO_PUBLIC_GAME_URL`
in `mobile/.env.local` to your game deployment; see `.env.example`. The default and example setting use the permanent GitHub Pages URL.
Override it only when testing another deployment.

## Standalone iPhone / TestFlight build

The Expo Go preview is a native development app, not a signed standalone `.ipa`.
The project includes iOS permissions, icon, app identity, and EAS build profiles.
EAS can create the standalone app from Windows using Apple's build infrastructure.
It needs an Expo account and Apple Developer signing credentials; see
[Expo's iOS build setup](https://docs.expo.dev/build/setup/).

From `mobile/`:

```powershell
npx eas-cli@latest login
npx eas-cli@latest build:configure
npm run build:ios
```

Use the `production` profile for a TestFlight/App Store build. Submit the resulting
build with `npx eas-cli@latest submit --platform ios`. For registered test devices,
use `npx eas-cli@latest build --platform ios --profile preview`. The `simulator`
profile produces an unsigned simulator app that runs on a Mac's iOS Simulator;
it cannot be installed on a physical iPhone. No store submission has been made.

The initial bundle identifier is `com.emirhansimsek.sliceparty`. Change it in
`app.json` before registering a different app identity. This app has its own
identity; it does not reuse SpellsCast's EAS project, provisioning, or store entry.

The app has a dedicated [Slice Party EAS project](https://expo.dev/accounts/emirhansimsek_lightning/projects/slice-party). Apple distribution credentials must be configured for this app identity before a standalone iPhone build. Run `npm run build:ios` interactively with your Apple Developer team. Earlier simulator archives were built before the rename and should not be distributed; build a new simulator archive with `npm run build:simulator`.

## Name clearance

Slice Party is the requested working name. An existing slicing game uses the same name on [Google Play](https://play.google.com/store/apps/details?id=com.funplosionstudio.sliceparty). Removing the previous branding does not establish trademark clearance or eliminate other intellectual property obligations. Check the name and assets before commercial release.

## Validation

```powershell
npm run typecheck
npm run lint
npm test
npm run test:relay
npx expo-doctor
npx expo export --platform ios
```

Unit tests cover room links, slot allocation, exact native/browser motion parity,
send throttling, pending endpoints, stationary input, and disconnects. The live
relay check creates only its own temporary room and verifies concurrent joins,
two-player limits, movement, commands, HUD delivery, and removal of player data.
Export verifies the iOS JavaScript/Hermes bundle; signing and physical iPhone
sensor testing are separate steps.

Motion and camera are requested only when needed. Camera frames stay on the
phone; only the decoded room code is used. Sword coordinates, room membership,
and game commands use the existing Firebase relay. Backgrounding or leaving
releases the player's nodes; rejoin after returning to the app. Touch controls
remain available when motion permission is denied.
