/** Browser stub for MetaMask SDK's optional React Native async-storage peer. */
const AsyncStorage = {
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
  mergeItem: async () => undefined,
  clear: async () => undefined,
  getAllKeys: async () => [],
  multiGet: async () => [],
  multiSet: async () => undefined,
  multiRemove: async () => undefined,
};

module.exports = AsyncStorage;
module.exports.default = AsyncStorage;
