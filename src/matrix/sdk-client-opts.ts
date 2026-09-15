import type { ICreateClientOpts } from "matrix-js-sdk";
import { pinnedFetch } from "../network-policy.js";

export function createMatrixSdkClientOptions(input: {
  baseUrl: string;
  userId: string;
  deviceId?: string;
  cryptoCallbacks: NonNullable<ICreateClientOpts["cryptoCallbacks"]>;
}): ICreateClientOpts {
  return {
    baseUrl: input.baseUrl,
    userId: input.userId,
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    cryptoCallbacks: input.cryptoCallbacks,
    fetchFn: pinnedFetch as ICreateClientOpts["fetchFn"],
  };
}
