import * as sdk from "matrix-js-sdk";
import { ClientEvent, type MatrixClient } from "matrix-js-sdk";
import { hopSyncFilterDefinition, shouldInitRustCrypto } from "../hop-client-mode.js";
import { applyNodeNetworkPolicy, pinnedFetch } from "../network-policy.js";
import { createMatrixSdkClientOptions } from "./sdk-client-opts.js";

export type HopMatrixClientConfig = {
  homeserverUrl: string;
  userId: string;
  accessToken: string;
  deviceId?: string;
  enableOAuth?: boolean;
  enableTokenExchange?: boolean;
};

async function waitForUsableSync(client: MatrixClient, timeoutMs = 60_000): Promise<void> {
  const ready = (state: string | null) => state === "PREPARED" || state === "SYNCING" || state === "CATCHUP";
  if (ready(client.getSyncState())) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener(ClientEvent.Sync, onSync);
      reject(new Error("Matrix sync timeout"));
    }, timeoutMs);
    const onSync = (state: string) => {
      if (!ready(state)) return;
      clearTimeout(timer);
      client.removeListener(ClientEvent.Sync, onSync);
      resolve();
    };
    client.on(ClientEvent.Sync, onSync);
    if (ready(client.getSyncState())) {
      clearTimeout(timer);
      client.removeListener(ClientEvent.Sync, onSync);
      resolve();
    }
  });
}

export async function createMatrixClient(config: HopMatrixClientConfig): Promise<MatrixClient> {
  applyNodeNetworkPolicy();
  if (!config.homeserverUrl) throw new Error("Homeserver URL is required to create a Matrix client.");
  if (!config.userId) throw new Error("User ID is required to create a Matrix client.");
  if (!config.accessToken) throw new Error("Access token is required to create a Matrix client.");

  let deviceId = config.deviceId || process.env.MATRIX_DEVICE_ID;
  if (!deviceId) {
    try {
      const res = await pinnedFetch(`${config.homeserverUrl.replace(/\/$/, "")}/_matrix/client/v3/account/whoami`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      const body = (await res.json()) as { device_id?: string; user_id?: string };
      if (body.device_id) deviceId = body.device_id;
    } catch {
      // whoami is optional; SDK can still start with the session token
    }
  }

  const client = sdk.createClient(
    createMatrixSdkClientOptions({
      baseUrl: config.homeserverUrl,
      userId: config.userId,
      deviceId,
      cryptoCallbacks: {},
    }),
  );
  client.setAccessToken(config.accessToken);

  const hop = !shouldInitRustCrypto();
  if (!hop) {
    console.error("[hf-pipe] rust crypto off is the hop default; unexpected HF_SIDE");
  } else {
    console.error(`[hf-pipe] rust crypto off. Device ID: ${client.getDeviceId() || deviceId || ""}`);
  }

  let filter: sdk.Filter | undefined;
  if (hop) {
    filter = new sdk.Filter(config.userId);
    filter.setDefinition(hopSyncFilterDefinition());
  }

  await client.startClient({
    initialSyncLimit: hop ? 0 : 20,
    pollTimeout: 10_000,
    lazyLoadMembers: true,
    ...(filter ? { filter } : {}),
  });
  await waitForUsableSync(client);
  return client;
}
