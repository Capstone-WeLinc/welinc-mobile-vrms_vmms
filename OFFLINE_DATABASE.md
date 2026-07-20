# VMMS mobile offline database

The app creates `vmms_mobile.db` automatically on first launch using Expo SQLite.
The local repositories are the UI's data source whether the device is online or
offline. `SyncService` pulls authenticated snapshots from the existing endpoints:

- `GET /vehicles`
- `GET /maintenance-schedules`
- `GET /checklists`

Authentication and synchronization are wired into `App.tsx`. The app posts to
`/auth/login`, stores the JWT in Expo SecureStore, restores valid sessions, and
starts synchronization while the authenticated dashboard is mounted. The core
integration is equivalent to:

```ts
import * as SecureStore from 'expo-secure-store';
import { SyncService } from './services/SyncService';

const syncService = new SyncService({
  apiBaseUrl: 'http://YOUR-LAN-IP:3000',
  getAccessToken: () => SecureStore.getItemAsync('accessToken'),
});

const stopAutoSync = syncService.startAutoSync();
// Later: stopAutoSync();
```

Create a local `.env` before starting Expo:

```powershell
Copy-Item .env.example .env
```

Then set `EXPO_PUBLIC_API_BASE_URL` to an address reachable from the selected
device. Restart Expo after changing this value.

Do not use `localhost` on a physical phone; use the backend machine's LAN IP and
ensure the phone can reach that port. Android Emulator commonly uses
`http://10.0.2.2:<port>` for the host machine.

The current backend list responses do not expose `updatedAt`. The mapper is ready
to use it when present, but currently performs an atomic full-snapshot
reconciliation: it upserts returned records and removes records absent from a
successful complete response. A failed or partial HTTP request never replaces the
last good cache. Local checklist `isChecked` values are preserved across refreshes.

Useful commands:

```powershell
npm ci
npx expo start
```

In the Expo CLI terminal, press `Shift+M` and choose
**expo-drizzle-studio-plugin**. Drizzle Studio opens in the browser and connects
to the on-device `vmms_mobile.db` database. Keep the app open on the device while
using the inspector.
