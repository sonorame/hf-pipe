export function createMatrixSdkClientOptions(input) {
    return {
        baseUrl: input.baseUrl,
        userId: input.userId,
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        cryptoCallbacks: input.cryptoCallbacks,
    };
}
//# sourceMappingURL=sdk-client-opts.js.map