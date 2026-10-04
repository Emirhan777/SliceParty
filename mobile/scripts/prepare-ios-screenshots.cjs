const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const xcrun = args => execFileSync('xcrun', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
const devices = JSON.parse(xcrun(['simctl', 'list', 'devices', 'available', '--json']));
const all = Object.values(devices.devices).flat();
const device = ['iPhone 17 Pro Max', 'iPhone 16 Pro Max', 'iPhone 15 Pro Max']
  .map(name => all.find(d => d.name === name && d.isAvailable)).find(Boolean);
if (!device) throw new Error('No supported Pro Max simulator is available: ' + all.map(d => d.name).join(', '));
fs.mkdirSync('artifacts/screenshots', { recursive: true });
fs.writeFileSync('artifacts/screenshots/device-udid.txt', device.udid);
fs.writeFileSync('artifacts/screenshots/provenance.json', JSON.stringify({ device: device.name, bundleIdentifier: 'com.emirhansimsek.sliceparty', source: 'Standalone iOS Simulator app', capturedAt: new Date().toISOString() }, null, 2));
if (device.state !== 'Booted') xcrun(['simctl', 'boot', device.udid]);
xcrun(['simctl', 'bootstatus', device.udid, '-b']);
xcrun(['simctl', 'status_bar', device.udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100']);
const apps = [];
if (process.argv[2]) {
  const search = (folder, depth = 0) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(folder, entry.name);
      if (entry.name.endsWith('.app')) apps.push(file);
      else if (depth < 2) search(file, depth + 1);
    }
  };
  search(process.argv[2]);
} else {
  const products = 'ios/build/Build/Products';
  for (const folder of fs.readdirSync(products)) {
    if (!folder.endsWith('iphonesimulator')) continue;
    const base = path.join(products, folder);
    for (const entry of fs.readdirSync(base)) if (entry.endsWith('.app')) apps.push(path.join(base, entry));
  }
}
if (apps.length !== 1) throw new Error('Expected one simulator app, found: ' + apps.join(', '));
xcrun(['simctl', 'install', device.udid, apps[0]]);
console.log('Installed Slice Party on ' + device.name);
