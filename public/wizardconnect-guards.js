/** Small, dependency-free guards for the browser's WizardConnect session state. */
export function getWizardConnectSessionState(manager, relay) {
  if (!manager || !relay) return { ready: false, paths: [], reason: 'not-connected' };
  if (manager.protocol !== 'hdwalletv1') return { ready: false, paths: [], reason: 'unsupported-protocol' };
  let paths;
  try { paths = manager.getSessionPaths(); }
  catch { return { ready: false, paths: [], reason: 'invalid-public-paths' }; }
  if (!Array.isArray(paths) || paths.length === 0) return { ready: false, paths: [], reason: 'missing-public-paths' };

  // hdwalletv1 delivers one named extended public key per path. Do not mark a
   // session signing-ready merely because an object with a `name` field exists.
  const supported = new Set(['receive', 'change', 'defi']);
  const names = new Set();
  for (const path of paths) {
    if (!path || typeof path !== 'object' || !supported.has(path.name) ||
        typeof path.xpub !== 'string' || path.xpub.trim().length === 0 || names.has(path.name)) {
      return { ready: false, paths: [], reason: 'invalid-public-paths' };
    }
    names.add(path.name);
  }
  return { ready: names.size > 0, paths, pathNames: names, reason: null };
}

/** Ensure every requested signing path was actually shared by the paired wallet. */
export function validateWalletInputPaths(inputPaths, availablePathNames) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error('Provide input paths for the transaction before requesting a wallet signature.');
  }
  const available = availablePathNames instanceof Set ? availablePathNames : new Set(availablePathNames || []);
  const seenInputs = new Set();
  for (const tuple of inputPaths) {
    if (!Array.isArray(tuple) || tuple.length !== 3) {
      throw new Error('Each signing input path must be [inputIndex, pathName, addressIndex].');
    }
    const [inputIndex, pathName, addressIndex] = tuple;
    if (!Number.isSafeInteger(inputIndex) || inputIndex < 0 ||
        !Number.isSafeInteger(addressIndex) || addressIndex < 0 ||
        typeof pathName !== 'string' || !available.has(pathName)) {
      throw new Error(`The connected wallet did not share the required valid path for input ${String(inputIndex)}. Reconnect a compatible BCH wallet or correct the input path mapping.`);
    }
    if (seenInputs.has(inputIndex)) throw new Error(`Duplicate signing path for transaction input ${inputIndex}.`);
    seenInputs.add(inputIndex);
  }
  return true;
}

/** Validate the documented hdwalletv1 response envelope before trusting its payload. */
export function validateWalletSigningResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Wallet returned an invalid signing response.');
  }
  if (response.error) {
    throw new Error(`Wallet declined or could not sign the request: ${String(response.error).slice(0, 180)}`);
  }
  if (response.action !== 'sign_transaction_response') {
    throw new Error('Wallet returned an unexpected signing response. No transaction was accepted.');
  }
  if (!Number.isSafeInteger(response.sequence) || response.sequence < 0 ||
      !Number.isSafeInteger(response.time) || response.time <= 0) {
    throw new Error('Wallet signing response is missing valid protocol sequence or timestamp fields.');
  }
  if (typeof response.signedTransaction !== 'string' ||
      response.signedTransaction.length === 0 ||
      response.signedTransaction.length % 2 !== 0 ||
      response.signedTransaction.length > 2_000_000 ||
      !/^[0-9a-f]+$/i.test(response.signedTransaction)) {
    throw new Error('Wallet returned no valid signed transaction hex. No transaction was accepted.');
  }
  return response.signedTransaction;
}
