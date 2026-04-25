import type {
  AuthResult,
  Entropy32,
  RandomBytesDep,
  SecureStorage,
  SensitiveInfoItem,
} from "@evolu/common";
import {
  Base64Url,
  base64UrlToUint8Array,
  bytesToUtf8,
  createSlip21,
  decryptWithXChaCha20Poly1305,
  EncryptionKey,
  encryptWithXChaCha20Poly1305,
  Entropy24,
  uint8ArrayToBase64Url,
  utf8ToBytes,
  XChaCha20Poly1305Ciphertext,
} from "@evolu/common";
import type { UseStore } from "idb-keyval";
import { clear, createStore, del, get, keys, set } from "idb-keyval";

export const createWebAuthnStore = (deps: RandomBytesDep): SecureStorage => ({
  setItem: async (key, value, options) => {
    if (options?.accessControl === "none") {
      const metadata = createMetadata(false);
      await set(key, { value, metadata }, getStore(options.service));
      return { metadata };
    }
    const seed = generateSeed(deps)();
    const authResult = JSON.parse(value) as AuthResult;
    const credential = await createCredential(deps)(
      options?.webAuthnUsername ?? "Evolu User",
      seed,
      options?.relyingPartyID,
      options?.relyingPartyName,
      options?.webAuthnUserVerification,
      options?.webAuthnAuthenticatorAttachment,
    );
    const prfOutput = readPrfOutput(credential);
    const keySeed = prfOutput ?? seed;
    const encryptionKey = deriveEncryptionKey(keySeed);
    const encryptedData = encryptAuthResult(deps)(authResult, encryptionKey);
    const credentialId = uint8ArrayToBase64Url(
      new Uint8Array(credential.rawId),
    );
    const metadata = createMetadata();
    await set(
      key,
      { credentialId, prf: prfOutput !== null, ...encryptedData, metadata },
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
      readonly prf?: boolean;
      readonly metadata: SensitiveInfoItem["metadata"];
    }>(key, getStore(options?.service));
    if (!data) {
      return null;
    }
    const credential = await getCredential(deps)(
      data.credentialId,
      options?.relyingPartyID,
      options?.webAuthnUserVerification,
    );
    let keySeed: Uint8Array;
    if (data.prf) {
      const prfOutput = readPrfOutput(credential);
      if (!prfOutput) {
        throw new WebAuthnAuthError({
          type: "recoverable",
          reason: "prf-unsupported",
        });
      }
      keySeed = prfOutput;
    } else {
      keySeed = extractSeedFromCredential(credential);
    }
    const encryptionKey = deriveEncryptionKey(keySeed);
    const authResultVal = decryptAuthResult(data, encryptionKey);
    if (!authResultVal) return null;
    return {
      key,
      service: options?.service ?? "default",
      value: authResultVal,
      metadata: data.metadata,
    };
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
const createMetadata = (isSecure = true): SensitiveInfoItem["metadata"] => ({
  backend: "keychain",
  accessControl: isSecure ? "biometryCurrentSet" : "none",
  securityLevel: isSecure ? "biometry" : "software",
  timestamp: Date.now(),
});

/** Get storage key for owner ID. (supports namespaces via prefix) */
const getStore = (prefix = "default"): UseStore =>
  createStore(prefix, "evolu-auth");

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
    const credential = await runCeremony(() =>
      navigator.credentials.create(options),
    );
    if (!credential) {
      throw new WebAuthnAuthError({ type: "bug", reason: "unknown" });
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
    const credential = await runCeremony(() =>
      navigator.credentials.get(options),
    );
    if (!credential?.response) {
      throw new WebAuthnAuthError({ type: "bug", reason: "unknown" });
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
  ): CredentialCreationOptions => ({
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
      extensions: { prf: { eval: { first: PRF_SALT } } } as PrfExtensionInputs,
    },
  });

const createCredentialRequestOptions =
  (deps: RandomBytesDep) =>
  (
    credentialId: string,
    relyingPartyID?: string,
    userVerification?: UserVerificationRequirement,
  ): CredentialRequestOptions => ({
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
      extensions: { prf: { eval: { first: PRF_SALT } } } as PrfExtensionInputs,
    },
  });

const deriveEncryptionKey = (seed: Uint8Array): EncryptionKey => {
  const seed32 = seed.length === 32 ? seed : seed.slice(0, 32);
  return EncryptionKey.orThrow(
    createSlip21(seed32 as Entropy32, ["evolu", "auth"]),
  );
};

const encryptAuthResult =
  (deps: RandomBytesDep) =>
  (
    authResult: AuthResult,
    encryptionKey: EncryptionKey,
  ): {
    nonce: Base64Url;
    ciphertext: Base64Url;
  } => {
    const plaintext = utf8ToBytes(JSON.stringify(authResult));
    const [ciphertext, nonce] = encryptWithXChaCha20Poly1305(deps)(
      plaintext,
      encryptionKey,
    );
    return {
      nonce: uint8ArrayToBase64Url(nonce),
      ciphertext: uint8ArrayToBase64Url(ciphertext),
    };
  };

const decryptAuthResult = (
  encryptedData: { nonce: Base64Url; ciphertext: Base64Url },
  encryptionKey: EncryptionKey,
): string | null => {
  const nonce = base64UrlToUint8Array(encryptedData.nonce);
  const ciphertext = base64UrlToUint8Array(encryptedData.ciphertext);
  const result = decryptWithXChaCha20Poly1305(
    XChaCha20Poly1305Ciphertext.orThrow(ciphertext),
    Entropy24.orThrow(nonce),
    encryptionKey,
  );
  if (!result.ok) return null;
  return bytesToUtf8(result.value);
};

const generateSeed = (deps: RandomBytesDep) => () =>
  deps.randomBytes.create(32);

/**
 * WebAuthn PRF extension salt. Constant per app; versioned to allow future key
 * rotation by changing the suffix. The PRF output is deterministic for a given
 * (credential, salt) pair on the same authenticator.
 */
const PRF_SALT = new TextEncoder().encode("evolu-v1");

/** Minimal typing for the PRF extension (not yet in lib.dom.d.ts). */
type PrfExtensionInputs = AuthenticationExtensionsClientInputs & {
  prf?: { eval?: { first: BufferSource } };
};
type PrfExtensionResults = AuthenticationExtensionsClientOutputs & {
  prf?: { results?: { first?: ArrayBuffer }; enabled?: boolean };
};

const readPrfOutput = (credential: PublicKeyCredential): Uint8Array | null => {
  const ext = credential.getClientExtensionResults() as PrfExtensionResults;
  const first = ext.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
};

/**
 * Classified WebAuthn ceremony outcome. Browsers collapse most failures into
 * `NotAllowedError`, so the bucket combines `error.name` with ceremony duration
 * to disambiguate user cancel vs. timeout vs. environment rejection.
 */
export type WebAuthnErrorBucket =
  | {
      type: "expected";
      reason: "user-cancel" | "timeout" | "abort" | "already-registered";
    }
  | {
      type: "recoverable";
      reason: "prf-unsupported" | "env-rejection" | "constraint" | "not-supported";
    }
  | { type: "bug"; reason: "security" | "data" | "unknown" };

export class WebAuthnAuthError extends Error {
  readonly bucket: WebAuthnErrorBucket;

  constructor(bucket: WebAuthnErrorBucket, cause?: unknown) {
    super(
      `WebAuthn ${bucket.type}: ${bucket.reason}`,
      cause !== undefined ? { cause } : undefined,
    );
    this.name = "WebAuthnAuthError";
    this.bucket = bucket;
  }
}

const classifyWebAuthnError = (
  error: unknown,
  durationMs: number,
): WebAuthnErrorBucket => {
  const name = (error as { name?: string } | null)?.name;
  if (name === "SecurityError") return { type: "bug", reason: "security" };
  if (name === "DataError") return { type: "bug", reason: "data" };
  if (name === "NotSupportedError")
    return { type: "recoverable", reason: "not-supported" };
  if (name === "ConstraintError")
    return { type: "recoverable", reason: "constraint" };
  if (name === "AbortError") return { type: "expected", reason: "abort" };
  if (name === "InvalidStateError")
    return { type: "expected", reason: "already-registered" };
  if (name === "NotAllowedError") {
    if (durationMs < 1_000)
      return { type: "recoverable", reason: "env-rejection" };
    if (durationMs > 30_000) return { type: "expected", reason: "timeout" };
    return { type: "expected", reason: "user-cancel" };
  }
  return { type: "bug", reason: "unknown" };
};

const runCeremony = async (
  fn: () => Promise<Credential | null>,
): Promise<PublicKeyCredential | null> => {
  const start = performance.now();
  try {
    return (await fn()) as PublicKeyCredential | null;
  } catch (error) {
    throw new WebAuthnAuthError(
      classifyWebAuthnError(error, performance.now() - start),
      error,
    );
  }
};
