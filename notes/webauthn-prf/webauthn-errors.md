# WebAuthn errory

Jeden `NotAllowedError` pokrývá asi 10 různých situací. Browser to dělá záměrně kvůli ochraně soukromí (nechce prozradit, jestli credential existuje).

### Timing heuristika

Pro `NotAllowedError` lze klasifikovat typ erroru pomocí heuristiky jak rychle error přijde:
- < 1 sek = Environment rejection – browser/OS rovnou odmítl, uživatel nic neviděl
- 1-15 sek = User cancel – viděl dialog a zavřel ho
- 15-30 sek = Uživatel neinteragoval – nevšiml si promptu
- 30+ sek = Timeout – ceremony vypršela

### Seznam errorů

| `error.name` | Kdy nastane | Typ | Řešení |
|---|---|---|---|
| `NotAllowedError` < 1 s | Environment rejection — PRF/UV/authenticator nedostupný | Recoverable | Memory-only fallback |
| `NotAllowedError` 1–30 s | Uživatel dialog zrušil nebo si ho nevšiml | Expected | Nabídnout retry, po druhém cancelu memory-only fallback |
| `NotAllowedError` 30+ s | Ceremony timeout | Expected | Nabídnout retry nebo memory-only fallback |
| `AbortError` | Navigace, re-render, konkurenční ceremony | Expected | Retry automaticky |
| `InvalidStateError` | Při `create()` už credential existuje | Expected | Přeskočit na `get()` |
| `NotSupportedError` | Browser neumí WebAuthn | Recoverable | Memory-only fallback |
| `ConstraintError` | Chybí biometrie | Recoverable | Memory-only fallback |
| PRF output `undefined` po úspěšné ceremony | WebAuthn OK, ale PRF extension chybí | Recoverable | Memory-only fallback |
| `SecurityError` | Ne-HTTPS, iframe bez permissions policy | Bug | Logovat, memory-only fallback |
| `DataError` | Nevalidní vstupy (base64 vs base64url encoding) | Bug | Logovat, memory-only fallback |
| `UnknownError` | Interní selhání authenticatoru / platformy | Bug | Retry, logovat, memory-only fallback |

### Návrh implementace

```typescript
type WebAuthnResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WebAuthnError }

type WebAuthnError =
  // Expected
  | { type: "user-cancel" }
  | { type: "timeout" }
  | { type: "abort" }
  | { type: "already-registered" }
  // Recoverable
  | { type: "prf-unsupported" }
  | { type: "env-rejection" }
  | { type: "not-supported" }
  | { type: "constraint" }
  // Bug
  | { type: "security"; detail: string }
  | { type: "data"; detail: string }
  | { type: "unknown"; detail: string }
```

```typescript
function classifyError(error: DOMException, durationMs: number): WebAuthnError {
  switch (error.name) {
    case "SecurityError":
      return { type: "security", detail: error.message };
    case "DataError":
      return { type: "data", detail: error.message };
    case "NotSupportedError":
      return { type: "not-supported" };
    case "ConstraintError":
      return { type: "constraint" };
    case "AbortError":
      return { type: "abort" };
    case "InvalidStateError":
      return { type: "already-registered" };

    // timing heuristic
    case "NotAllowedError":
      if (durationMs < 1_000) return { type: "env-rejection" };
      if (durationMs > 30_000) return { type: "timeout" };
      return { type: "user-cancel" };

    default:
      return { type: "unknown", detail: error.message };
  }
}
```

```typescript
let activeController: AbortController | null = null;

// Only one WebAuthn ceremony can run at a time — a second call while one is
// pending throws NotAllowedError. Abort the previous before starting a new one.
function abortActiveCeremony(): void {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
}
```

```typescript
async function prfCeremony(
  mode: "create" | "get",
  options: PublicKeyCredentialCreationOptions | PublicKeyCredentialRequestOptions,
): Promise
  | { ok: true; prfOutput: ArrayBuffer; credentialId: Uint8Array }
  | { ok: false; error: WebAuthnError }
> {
  abortActiveCeremony();
  activeController = new AbortController();
  const { signal } = activeController;
  const start = performance.now();

  try {
    const credential = (mode === "create"
      ? await navigator.credentials.create({ publicKey: options, signal })
      : await navigator.credentials.get({ publicKey: options, signal })
    ) as PublicKeyCredential;

    const ext = credential.getClientExtensionResults() as any;
    const prfOutput = ext.prf?.results?.first as ArrayBuffer | undefined;

    if (prfOutput) {
      return { ok: true, prfOutput, credentialId: new Uint8Array(credential.rawId) };
    }

    // CTAP 2.0/2.1 returns prf.enabled but no output on create()
    // follow up with get() is needed
    if (mode === "create" && ext.prf?.enabled) {
      const credentialId = new Uint8Array(credential.rawId);
      return prfCeremony("get", {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        userVerification: "required",
        allowCredentials: [{ type: "public-key", id: credentialId }],
        extensions: (options as any).extensions,
      });
    }

    return { ok: false, error: { type: "prf-unsupported" } };
  } catch (e) {
    return { ok: false, error: classifyError(e as DOMException, performance.now() - start) };
  } finally {
    activeController = null;
  }
}
```

```typescript
// Needs loadCredentialId() and saveCredentialId()

async function initDeviceOwner(): Promise<DeviceOwnerResult> {
  const credentialId = loadCredentialId();

  const result = credentialId
    ? await prfCeremony("get", {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        userVerification: "required",
        allowCredentials: [{ type: "public-key", id: credentialId }],
        extensions: { prf: { eval: { first: PRF_EVAL_INPUT } } },
      })
    : await prfCeremony("create", {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Evolu", id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "device", displayName: "Device Owner" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: PRF_EVAL_INPUT } } },
      });

  if (result.ok) {
    if (!credentialId) saveCredentialId(result.credentialId);
    return { type: "encrypted", keys: await deriveEvoluKeys(result.prfOutput, result.credentialId) };
  }

  switch (result.error.type) {
    // Expected — retry or ignore
    case "user-cancel":        return retryOnceOrMemoryOnly();
    case "timeout":            return retryOrMemoryOnly();
    case "abort":              return initDeviceOwner();
    case "already-registered": return initDeviceOwner();

    // Recoverable — memory-only fallback
    case "prf-unsupported":
    case "env-rejection":
    case "not-supported":
    case "constraint":
      return { type: "memory-only", reason: result.error.type };

    // Bug — log and memory-only fallback
    case "security":
    case "data":
    case "unknown":
      logError(result.error);
      return { type: "memory-only", reason: "bug" };
  }
}

```