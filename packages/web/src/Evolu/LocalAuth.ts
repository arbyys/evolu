import { set, get, del, keys, clear, createStore } from "idb-keyval";

import {
  createSlip21,
  utf8ToBytes,
  bytesToUtf8,
  base64UrlToUint8Array,
  uint8ArrayToBase64Url,
  EncryptionKey,
  Base64Url,
} from "@evolu/common";

import type {
  AuthResult,
  Entropy32,
  SensitiveInfoItem,
  SecureStorage,
  RandomBytesDep,
  SymmetricCryptoDep,
} from "@evolu/common";
import type { UseStore } from "idb-keyval";

/**
 * PRF extension input/output types for WebAuthn. These types are part of the
 * WebAuthn Level 3 spec but may not be available in all TypeScript DOM libs.
 */
interface AuthenticationExtensionsPRFValues {
  readonly first: BufferSource;
  readonly second?: BufferSource;
}

interface AuthenticationExtensionsPRFInputs {
  readonly eval?: AuthenticationExtensionsPRFValues;
  readonly evalByCredential?: Record<string, AuthenticationExtensionsPRFValues>;
}

interface AuthenticationExtensionsPRFOutputs {
  readonly enabled?: boolean;
  readonly results?: {
    readonly first?: ArrayBuffer;
    readonly second?: ArrayBuffer;
  };
}

/** Storage mode indicating how the encryption key is stored/derived. */
type StorageMode = "prf" | "userHandle";

/** Salt used for PRF key derivation - stored publicly alongside encrypted data. */
const PRF_SALT = new TextEncoder().encode("evolu-prf-encryption-key-v1");

/**
 * Detects if the WebAuthn PRF extension is supported by the current browser.
 * PRF support varies:
 *
 * - Chrome/Edge 116+: Full support
 * - Safari 18+: Only create(), no get() support
 * - Firefox 139+: Full support on desktop, no Android support
 *
 * Returns true only if PRF is likely to work for both registration AND
 * authentication flows.
 */
export const isPrfSupported = async (): Promise<boolean> => {
  // Check if PublicKeyCredential exists
  if (typeof PublicKeyCredential === "undefined") {
    return false;
  }

  // Safari supports PRF in create() but NOT in get() - detect Safari
  const isSafari =
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
    // Also check for iOS WebKit which has same limitation
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isSafari) {
    // Safari can't use PRF for authentication, so we can't rely on it
    return false;
  }

  // Firefox for Android doesn't support PRF
  const isFirefoxAndroid =
    /firefox/i.test(navigator.userAgent) && /android/i.test(navigator.userAgent);

  if (isFirefoxAndroid) {
    return false;
  }

  // For other browsers, check if the extension is available
  // We can't reliably detect PRF support without actually trying to use it
  // so we rely on user-agent detection above and assume support in modern
  // Chrome/Edge/Firefox desktop
  return true;
};

/**
 * Creates a WebAuthn-based secure storage with PRF extension support.
 *
 * When PRF extension is available, it uses the PRF to derive encryption keys
 * cryptographically from the authenticator. This is more secure than the
 * userHandle approach because:
 *
 * 1. The key material never leaves the authenticator
 * 2. Keys are derived deterministically from a salt, not stored
 * 3. Even if IndexedDB is compromised, data remains encrypted
 *
 * When PRF is not available (Safari, older browsers), falls back to storing
 * the encryption seed in the credential's userHandle field.
 *
 * @experimental
 */
export const createWebAuthnStore = (
  deps: RandomBytesDep & SymmetricCryptoDep,
): SecureStorage => ({
  setItem: async (key, value, options) => {
    if (options?.accessControl === "none") {
      const metadata = createMetadata(false);
      await set(key, { value, metadata }, getStore(options.service));
      return { metadata };
    }

    const prfSupported = await isPrfSupported();
    const authResult = JSON.parse(value) as AuthResult;

    if (prfSupported) {
      // PRF mode: derive key from authenticator's PRF
      const credential = await createCredentialWithPrf(deps)(
        options?.webAuthnUsername ?? "Evolu User",
        options?.relyingPartyID,
        options?.relyingPartyName,
        options?.webAuthnUserVerification,
        options?.webAuthnAuthenticatorAttachment,
      );

      const prfOutput = credential.getClientExtensionResults() as {
        prf?: AuthenticationExtensionsPRFOutputs;
      };

      // Check if PRF was actually enabled during registration
      if (prfOutput.prf?.enabled && prfOutput.prf.results?.first) {
        const prfKey = new Uint8Array(prfOutput.prf.results.first);
        const encryptionKey = deriveEncryptionKey(prfKey);
        const encryptedData = encryptAuthResult(deps)(authResult, encryptionKey);
        const credentialId = uint8ArrayToBase64Url(
          new Uint8Array(credential.rawId),
        );
        const metadata = createMetadata(true, "prf");
        await set(
          key,
          {
            credentialId,
            ...encryptedData,
            metadata,
            storageMode: "prf" as StorageMode,
          },
          getStore(options?.service),
        );
        return { metadata };
      }
      // PRF not enabled by authenticator - fall through to userHandle mode
    }

    // userHandle mode (fallback): store seed in credential's user.id
    const seed = generateSeed(deps)();
    const credential = await createCredential(deps)(
      options?.webAuthnUsername ?? "Evolu User",
      seed,
      options?.relyingPartyID,
      options?.relyingPartyName,
      options?.webAuthnUserVerification,
      options?.webAuthnAuthenticatorAttachment,
    );
    const encryptionKey = deriveEncryptionKey(seed);
    const encryptedData = encryptAuthResult(deps)(authResult, encryptionKey);
    const credentialId = uint8ArrayToBase64Url(
      new Uint8Array(credential.rawId),
    );
    const metadata = createMetadata(true, "userHandle");
    await set(
      key,
      {
        credentialId,
        ...encryptedData,
        metadata,
        storageMode: "userHandle" as StorageMode,
      },
      getStore(options?.service),
    );
    return { metadata };
  },

  getItem: async (key, options) => {
    if (options?.accessControl === "none") {
      const data = await get<{
        readonly value: string;
        readonly metadata: SensitiveInfoItem["metadata"];
      }>(key, getStore(options.service));
      return data
        ? {
            key,
            value: data.value,
            service: options.service ?? "default",
            metadata: data.metadata,
          }
        : null;
    }

    const data = await get<{
      readonly nonce: Base64Url;
      readonly ciphertext: Base64Url;
      readonly credentialId: string;
      readonly metadata: SensitiveInfoItem["metadata"];
      readonly storageMode?: StorageMode;
    }>(key, getStore(options?.service));

    if (!data) {
      return null;
    }

    try {
      // Determine storage mode - default to userHandle for backwards compatibility
      const storageMode: StorageMode = data.storageMode ?? "userHandle";

      let encryptionKey: EncryptionKey;

      if (storageMode === "prf") {
        // PRF mode: derive key from authenticator's PRF during assertion
        const credential = await getCredentialWithPrf(deps)(
          data.credentialId,
          options?.relyingPartyID,
          options?.webAuthnUserVerification,
        );

        const prfOutput = credential.getClientExtensionResults() as {
          prf?: AuthenticationExtensionsPRFOutputs;
        };

        if (!prfOutput.prf?.results?.first) {
          // PRF failed during assertion - this shouldn't happen if it worked
          // during registration, but handle gracefully
          return null;
        }

        const prfKey = new Uint8Array(prfOutput.prf.results.first);
        encryptionKey = deriveEncryptionKey(prfKey);
      } else {
        // userHandle mode: extract seed from credential response
        const credential = await getCredential(deps)(
          data.credentialId,
          options?.relyingPartyID,
          options?.webAuthnUserVerification,
        );
        const credentialSeed = extractSeedFromCredential(credential);
        encryptionKey = deriveEncryptionKey(credentialSeed);
      }

      const authResultVal = decryptAuthResult(deps)(data, encryptionKey);
      if (!authResultVal) {
        return null;
      }

      return {
        key,
        service: options?.service ?? "default",
        value: authResultVal,
        metadata: data.metadata,
      };
    } catch (_error) {
      return null;
    }
  },

  deleteItem: async (key, options) => {
    await del(key, getStore(options?.service));
    return true;
  },

  getAllItems: async (options) => {
    const service = options?.service ?? "default";
    const itemKeys = await keys<string>(getStore(service));
    const items = await Promise.all(
      itemKeys.map(async (key) => {
        const data = await get<{
          readonly metadata?: SensitiveInfoItem["metadata"];
          readonly value?: string;
        }>(key, getStore(service));
        return {
          key,
          service,
          metadata: data?.metadata ?? createMetadata(),
          ...(options?.includeValues && data?.value
            ? { value: data.value }
            : {}),
        };
      }),
    );
    return items;
  },

  clearService: async (options) => {
    await clear(getStore(options?.service));
  },
});

/**
 * Create default metadata for backwards compatibility with items that don't
 * have stored metadata.
 */
const createMetadata = (
  isSecure = true,
  mode?: StorageMode,
): SensitiveInfoItem["metadata"] => {
  return {
    backend: "keychain",
    accessControl: isSecure ? "biometryCurrentSet" : "none",
    securityLevel: isSecure
      ? mode === "prf"
        ? "secureEnclave"
        : "biometry"
      : "software",
    timestamp: Date.now(),
  };
};

/** Get storage key for owner ID. (supports namespaces via prefix) */
const getStore = (prefix = "default"): UseStore => {
  return createStore(prefix, "evolu-auth");
};

/**
 * Creates a WebAuthn credential with PRF extension enabled. The PRF extension
 * allows deriving keys from the authenticator, which is more secure than
 * storing secrets in userHandle.
 */
const createCredentialWithPrf =
  (deps: RandomBytesDep) =>
  async (
    username: string,
    relyingPartyID?: string,
    relyingPartyName?: string,
    userVerification?: UserVerificationRequirement,
    authenticatorAttachment?: AuthenticatorAttachment,
  ): Promise<PublicKeyCredential> => {
    const userId = generateSeed(deps)(); // Random user ID (not used for key derivation)

    const options: CredentialCreationOptions = {
      publicKey: {
        challenge: generateSeed(deps)() as BufferSource,
        rp: {
          id: relyingPartyID ?? document.location.hostname,
          name: relyingPartyName ?? "Evolu",
        },
        user: {
          id: userId as BufferSource,
          name: username,
          displayName: username,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -8 }, // Ed25519
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        attestation: "none",
        authenticatorSelection: {
          authenticatorAttachment: authenticatorAttachment ?? "platform",
          userVerification: userVerification ?? "required",
          residentKey: "required",
          requireResidentKey: true,
        },
        extensions: {
          // Request PRF extension - evaluate with our salt during registration
          prf: {
            eval: {
              first: PRF_SALT,
            },
          },
        } as AuthenticationExtensionsClientInputs & {
          prf: AuthenticationExtensionsPRFInputs;
        },
      },
    };

    const credential = (await navigator.credentials.create(
      options,
    )) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error("Failed to create WebAuthn credential with PRF");
    }

    return credential;
  };

/**
 * Gets a WebAuthn credential with PRF extension for key derivation during
 * authentication.
 */
const getCredentialWithPrf =
  (deps: RandomBytesDep) =>
  async (
    credentialId: string,
    relyingPartyID?: string,
    userVerification?: UserVerificationRequirement,
  ): Promise<PublicKeyCredential> => {
    const credentialIdBytes = base64UrlToUint8Array(
      Base64Url.orThrow(credentialId),
    );
    const credentialIdBase64 = uint8ArrayToBase64Url(credentialIdBytes);

    const options: CredentialRequestOptions = {
      publicKey: {
        challenge: generateSeed(deps)() as BufferSource,
        rpId: relyingPartyID ?? document.location.hostname,
        userVerification: userVerification ?? "required",
        allowCredentials: [
          {
            type: "public-key",
            id: credentialIdBytes as BufferSource,
          },
        ],
        extensions: {
          // Request PRF evaluation during authentication
          prf: {
            evalByCredential: {
              [credentialIdBase64]: {
                first: PRF_SALT,
              },
            },
          },
        } as AuthenticationExtensionsClientInputs & {
          prf: AuthenticationExtensionsPRFInputs;
        },
      },
    };

    const credential = (await navigator.credentials.get(
      options,
    )) as PublicKeyCredential | null;

    if (!credential?.response) {
      throw new Error("Failed to get WebAuthn credential with PRF");
    }

    return credential;
  };

const createCredential =
  (deps: RandomBytesDep) =>
  async (
    username: string,
    seed: Uint8Array,
    relyingPartyID?: string,
    relyingPartyName?: string,
    userVerification?: UserVerificationRequirement,
    authenticatorAttachment?: AuthenticatorAttachment,
  ): Promise<PublicKeyCredential> => {
    const options = createCredentialCreationOptions(deps)(
      username,
      seed,
      relyingPartyID,
      relyingPartyName,
      userVerification,
      authenticatorAttachment,
    );
    const credential = (await navigator.credentials.create(
      options,
    )) as PublicKeyCredential | null;
    if (!credential) {
      throw new Error("Failed to create WebAuthn credential");
    }
    return credential;
  };

const getCredential =
  (deps: RandomBytesDep) =>
  async (
    credentialId: string,
    relyingPartyID?: string,
    userVerification?: UserVerificationRequirement,
  ): Promise<PublicKeyCredential> => {
    const options = createCredentialRequestOptions(deps)(
      credentialId,
      relyingPartyID,
      userVerification,
    );
    const credential = (await navigator.credentials.get(
      options,
    )) as PublicKeyCredential | null;
    if (!credential?.response) {
      throw new Error("Failed to get WebAuthn credential");
    }
    return credential;
  };

const extractSeedFromCredential = (
  credential: PublicKeyCredential,
): Uint8Array => {
  const response = credential.response as AuthenticatorAssertionResponse;
  if (!response.userHandle) {
    throw new Error("No userHandle in credential response");
  }
  return new Uint8Array(response.userHandle);
};

const createCredentialCreationOptions =
  (deps: RandomBytesDep) =>
  (
    username: string,
    seed: Uint8Array,
    relyingPartyID?: string,
    relyingPartyName?: string,
    userVerification?: UserVerificationRequirement,
    authenticatorAttachment?: AuthenticatorAttachment,
  ): CredentialCreationOptions => {
    return {
      publicKey: {
        challenge: generateSeed(deps)() as BufferSource,
        rp: {
          id: relyingPartyID ?? document.location.hostname,
          name: relyingPartyName ?? "Evolu",
        },
        user: {
          id: seed as BufferSource,
          name: username,
          displayName: username,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -8 }, // Ed25519
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        attestation: "none",
        authenticatorSelection: {
          // - "platform": Uses the platform's built-in authenticator.
          // - "cross-platform": Uses a device specific authenticator (yubikey, fido2, etc.)
          authenticatorAttachment: authenticatorAttachment ?? "platform",
          // - "discouraged": Only User Presence is needed.
          // - "preferred": User Verification is preferred but not required. Falls back to User Presence.
          // - "required": User Verification MUST occur (biometrics/PIN). Clients may silently downgrade to User Presence only.
          userVerification: userVerification ?? "required",
          // - "discouraged": Server-side credential is preferable, but will accept client-side discoverable credential.
          // - "preferred": Relying Party strongly prefers client-side discoverable credential but will accept server-side credential.
          // - "required": Client-side discoverable credential MUST be created, error if it can't be created.
          residentKey: "required",
          // Included for backwards compatibility. Deprecated in favor of residentKey (true = "required")
          requireResidentKey: true,
        },
      },
    };
  };

const createCredentialRequestOptions =
  (deps: RandomBytesDep) =>
  (
    credentialId: string,
    relyingPartyID?: string,
    userVerification?: UserVerificationRequirement,
  ): CredentialRequestOptions => {
    return {
      publicKey: {
        challenge: generateSeed(deps)() as BufferSource,
        rpId: relyingPartyID ?? document.location.hostname,
        userVerification: userVerification ?? "preferred",
        allowCredentials: [
          {
            type: "public-key",
            id: base64UrlToUint8Array(
              Base64Url.orThrow(credentialId),
            ) as BufferSource,
          },
        ],
      },
    };
  };

const deriveEncryptionKey = (seed: Uint8Array): EncryptionKey => {
  const seed32 = seed.length === 32 ? seed : seed.slice(0, 32);
  return EncryptionKey.orThrow(
    createSlip21(seed32 as Entropy32, ["evolu", "auth"]),
  );
};

const encryptAuthResult =
  (deps: SymmetricCryptoDep) =>
  (
    authResult: AuthResult,
    encryptionKey: EncryptionKey,
  ): {
    nonce: Base64Url;
    ciphertext: Base64Url;
  } => {
    const plaintext = utf8ToBytes(JSON.stringify(authResult));
    const { nonce, ciphertext } = deps.symmetricCrypto.encrypt(
      plaintext,
      encryptionKey,
    );
    return {
      nonce: uint8ArrayToBase64Url(nonce),
      ciphertext: uint8ArrayToBase64Url(ciphertext),
    };
  };

const decryptAuthResult =
  (deps: SymmetricCryptoDep) =>
  (
    encryptedData: { nonce: Base64Url; ciphertext: Base64Url },
    encryptionKey: EncryptionKey,
  ): string | null => {
    const nonce = base64UrlToUint8Array(encryptedData.nonce);
    const ciphertext = base64UrlToUint8Array(encryptedData.ciphertext);
    const result = deps.symmetricCrypto.decrypt(
      ciphertext,
      encryptionKey,
      nonce,
    );
    if (!result.ok) return null;
    return bytesToUtf8(result.value);
  };

const generateSeed = (deps: RandomBytesDep) => () => {
  return deps.randomBytes.create(32);
};
