# Evolu LocalAuth: WebAuthn PRF Extension & Error Heuristics

> Návrh implementace pro derivaci šifrovacích klíčů z WebAuthn PRF extension  
> a zavedení heuristik pro klasifikaci WebAuthn chyb v produkčním prostředí.

---

## 1. Motivace

Evolu aktuálně odvozuje šifrovací klíče z BIP-39 mnemonicu přes SLIP-21. Uživatel buď
dostane auto-generovaný mnemonic, nebo ho zadá při obnově. Docs zmiňují alternativu:

> *"…encryption key derived from a cryptographically strong secret (which can be represented
> as a mnemonic) **or provided by an external hardware device**."*

WebAuthn PRF extension je přesně ten „external hardware device" scénář — umožňuje derivovat
deterministický, 32-byte kryptografický výstup přímo z authenticatoru (TPM / Secure Enclave),
aniž by klíčový materiál opustil hardware. Server ani poskytovatel nikdy nevidí klíč.

Trezor Suite řeší analogický problém (issue [#537](https://github.com/evoluhq/evolu/issues/537)):
potřebují předat klíče (`ownerId`, `writeKey`, `encryptionKey`) přímo do `createEvolu`,
protože k mnemonicu nemají přístup. PRF je další instancí stejného vzoru.

---

## 2. Aktuální stav: `user.id` hack

LocalAuth v současnosti využívá WebAuthn, ale **nepoužívá PRF extension**. Místo toho
spoléhá na `user.id` field jako prostředek pro přenos dat — není to standardní
ani bezpečnostně robustní přístup ke key derivation. PRF extension je purpose-built
mechanismus specifikovaný ve WebAuthn Level 3 přesně pro tento účel.

---

## 3. Navrhovaná architektura

### 3.1 Key hierarchy

```
WebAuthn PRF output (32 bytes)
        │
        ▼  HKDF-SHA256
   ┌────┴─────────────────────────────────────────┐
   │  salt: credentialId                          │
   │  info: "evolu-{ownerId|writeKey|encKey}-v1"  │
   └──────────────────────────────────────────────┘
        │
        ▼
  ownerId + writeKey + encryptionKey
        │
        ▼
  createEvolu({ externalOwner: { ... } })
```

PRF output se **nikdy neukládá** — existuje pouze v paměti po dobu odemykání.
Jediné co se persistuje lokálně je `credentialId` (veřejná reference pro opakované `.get()`).

### 3.2 Proč HKDF, ne přímé použití PRF výstupu

- Domain separation: každý klíč má unikátní `info` string
- Správná délka výstupu garantovaná bez ohledu na authenticator
- Budoucí rozšiřitelnost (key rotation přes `second` salt v PRF)

### 3.3 PRF vstupní salt

```javascript
extensions: {
  prf: {
    eval: {
      first: new TextEncoder().encode("evolu-v1")
    }
  }
}
```

Salt je konstantní per-aplikaci. Determinismus zajišťuje, že stejný credential na stejném
zařízení vždy vrátí totožný výstup. Verzování (`evolu-v1`) umožňuje budoucí key rotation
přes změnu verze.

---

## 4. Implementace WebAuthn ceremony

### 4.1 Registrace (první spuštění)

```typescript
async function registerWithPrf(userId: string) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const prfSalt = new TextEncoder().encode("evolu-v1");

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Evolu App", id: location.hostname },
      user: {
        id: new TextEncoder().encode(userId),
        name: userId,
        displayName: userId,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 },  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      extensions: {
        prf: { eval: { first: prfSalt } },
      },
    },
  });

  const ext = credential.getClientExtensionResults();
  const prfOutput = ext.prf?.results?.first;

  if (!prfOutput) {
    // PRF nepodporováno → fallback
    return { type: "prf-unsupported" as const };
  }

  return {
    type: "ok" as const,
    credentialId: new Uint8Array(credential.rawId),
    prfOutput: new Uint8Array(prfOutput),
  };
}
```

### 4.2 Odemknutí (každý start)

```typescript
async function authenticateWithPrf(credentialId: Uint8Array) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const prfSalt = new TextEncoder().encode("evolu-v1");

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      userVerification: "required",
      allowCredentials: [{ type: "public-key", id: credentialId }],
      extensions: {
        prf: { eval: { first: prfSalt } },
      },
    },
  });

  const ext = assertion.getClientExtensionResults();
  return ext.prf?.results?.first; // ArrayBuffer | undefined
}
```

### 4.3 HKDF derivace Evolu klíčů

```typescript
async function deriveEvoluKeys(prfOutput: ArrayBuffer, credentialId: ArrayBuffer) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", prfOutput, "HKDF", false, ["deriveBits"]
  );

  async function derive(info: string): Promise<ArrayBuffer> {
    return crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(credentialId),
        info: new TextEncoder().encode(info),
      },
      keyMaterial,
      256
    );
  }

  return {
    ownerId:       await derive("evolu-ownerId-v1"),
    writeKey:      await derive("evolu-writeKey-v1"),
    encryptionKey: await derive("evolu-encryptionKey-v1"),
  };
}
```

---

## 5. Fallback strategie

PRF podpora závisí na třech vrstvách (authenticator, OS, browser) a selhání na jakékoliv
z nich znamená nedostupnost. Proto je fallback **povinnou** součástí implementace.

### 5.1 Rozhodovací strom

```
isPrfAvailable?
   ├── ANO → PRF → HKDF → Evolu klíče  ✓
   └── NE
         ├── Platform authenticator existuje, jen bez PRF?
         │      → Mnemonic-based flow (stávající chování)
         └── WebAuthn vůbec nedostupné?
                → Mnemonic-based flow (stávající chování)
```

### 5.2 Aktuální podpora PRF (stav březen 2026)

| Platforma | Browser | Platform auth | Security key | CDA/Hybrid |
|-----------|---------|:---:|:---:|:---:|
| Android | Chrome/Edge | ✅ | ✅ | ✅ |
| Android | Samsung Internet | ✅ | ✅ | ✅ |
| Android | Firefox | ❌ | ❌ | ❌ |
| macOS 15+ | Safari 18+ | ✅ | ❌ | ✅ |
| macOS 15+ | Chrome 132+ | ✅ | ✅ | ✅ |
| macOS 15+ | Firefox 139+ | ✅ | ✅ | ✅ |
| iOS/iPadOS 18+ | Safari/Chrome/FF | ✅ | ❌ | ✅ (18.4+) |
| Windows 11 25H2 (Feb 2026+) | Firefox 148+ | ✅ | ✅ | ✅ |
| Windows 11 25H2 (Feb 2026+) | Chrome/Edge 147+ | ✅ | ✅ | ✅ |
| Windows 11 (starší) | Chrome/Edge 116+ | ❌ | ✅ | ✅ |
| Windows 10 | všechny | ❌ | ❌ | ❌ |

Poznámky:

- iOS 18.0–18.3 má bug způsobující ztrátu dat při CDA (cross-device auth) — opraveno v 18.4+
- Safari na macOS 26.4 vrací nešifrovaný hmac-secret výstup při použití security keys (WebKit bug 311099)
- Chrome/Edge < 147 na Windows 25H2 nepodporují PRF při registraci (create), jen při autentizaci (get)
- Mnemonic zůstává jako univerzální fallback i backup recovery mechanismus

### 5.3 Mnemonic jako recovery

Mnemonic z Evolu **nezaniká** — stává se sekundárním recovery mechanismem:

- Uživatel si mnemonic zapíše při prvním spuštění (jako dnes)
- Primární UX: odemykání přes PRF (biometrika, bez viditelného klíče)
- Při ztrátě zařízení / nefunkčním PRF: obnova přes mnemonic

---

## 6. WebAuthn Error Heuristics

### 6.1 Proč je klasifikace chyb kritická

Browsery vracejí malou sadu `DOMException` jmen, kde jeden název (typicky
`NotAllowedError`) pokrývá řadu naprosto odlišných situací — od „uživatel zrušil dialog"
přes „timeout" po „PRF/UV nedostupné". V optimalizovaných produkčních deploymentech
tvoří očekávané chování (cancel, timeout) přes 95 % všech zachycených chyb.

Bez klasifikace:
- Error metriky jsou zanesené normálními cancely
- Skutečné regrese jsou skryté uvnitř masy `NotAllowedError`
- UI reaguje špatně (spinner běží, fallback se nenabídne)

### 6.2 Taxonomie: tři buckety

#### Bucket 1: Expected (očekávané, nealarmovat)

| `error.name` | Heuristika | Akce v Evolu |
|---|---|---|
| `NotAllowedError` + čas 1–15 s | Uživatel zrušil dialog | Restore UI, nabídni retry |
| `NotAllowedError` + čas 30+ s | Timeout ceremony | Restore UI, nabídni fallback |
| `AbortError` | Navigace / re-render během ceremony | Retry automaticky jednou |
| `InvalidStateError` při create | Credential již existuje | Přeskoč na `.get()` |

#### Bucket 2: Recoverable (fallback na mnemonic)

| `error.name` | Heuristika | Akce v Evolu |
|---|---|---|
| `NotAllowedError` + čas < 1 s | Environment rejection (chybí schopnost) | Fallback na mnemonic |
| `NotSupportedError` | Browser nepodporuje WebAuthn/PRF | Fallback na mnemonic |
| `ConstraintError` | Nesplnitelné požadavky (chybí screen lock) | Vysvětli uživateli, fallback |
| PRF output `undefined` | WebAuthn OK, ale PRF extension chybí | Fallback na mnemonic |

#### Bucket 3: Bug (logovat, opravit)

| `error.name` | Heuristika | Akce v Evolu |
|---|---|---|
| `SecurityError` | RP ID / origin mismatch, chybí HTTPS | Logovat jako dev error |
| `DataError` | Malformované vstupy (encoding) | Logovat jako dev error |
| `UnknownError` | Platform / authenticator selhání | Retry → fallback → logovat |

### 6.3 Klíčový signál: timing

Timing od začátku ceremony (`performance.now()`) je nejdůležitější disambiguační signál:

| Interval | Interpretace |
|---|---|
| < 1 s | Environment rejection — PRF/UV/platform nedostupné |
| 1–15 s | Uživatel viděl dialog a zrušil ho |
| 15–30 s | Uživatel neinteragoval (možná si nevšiml promptu) |
| 30+ s | Ceremony timeout |

Prohlížeče z důvodu soukromí nerozlišují „uživatel zrušil" od „žádný credential neexistuje".
Timing je jediný spolehlivý proxy signál.

### 6.4 Implementace klasifikátoru

```typescript
type ErrorBucket =
  | { type: "expected"; reason: "user-cancel" | "timeout" | "abort" | "already-registered" }
  | { type: "recoverable"; reason: "prf-unsupported" | "env-rejection" | "constraint" | "not-supported" }
  | { type: "bug"; reason: "security" | "data" | "unknown"; error: Error }

function classifyWebAuthnError(
  error: DOMException,
  durationMs: number,
): ErrorBucket {
  const name = error.name;

  // ── Bucket 3: Bugs (deterministic, check first) ──
  if (name === "SecurityError") return { type: "bug", reason: "security", error };
  if (name === "DataError")     return { type: "bug", reason: "data", error };

  // ── Bucket 2: Recoverable ──
  if (name === "NotSupportedError") return { type: "recoverable", reason: "not-supported" };
  if (name === "ConstraintError")   return { type: "recoverable", reason: "constraint" };

  // ── NotAllowedError: timing heuristic ──
  if (name === "NotAllowedError") {
    if (durationMs < 1_000) return { type: "recoverable", reason: "env-rejection" };
    if (durationMs > 30_000) return { type: "expected", reason: "timeout" };
    return { type: "expected", reason: "user-cancel" };
  }

  // ── AbortError ──
  if (name === "AbortError") return { type: "expected", reason: "abort" };

  // ── InvalidStateError ──
  if (name === "InvalidStateError") return { type: "expected", reason: "already-registered" };

  // ── Catch-all ──
  return { type: "bug", reason: "unknown", error };
}
```

### 6.5 PRF-aware ceremony wrapper

```typescript
async function prfCeremony(
  mode: "create" | "get",
  options: CredentialCreationOptions | CredentialRequestOptions,
): Promise<
  | { ok: true; prfOutput: ArrayBuffer; credentialId: Uint8Array }
  | { ok: false; bucket: ErrorBucket }
> {
  const start = performance.now();

  try {
    const credential = mode === "create"
      ? await navigator.credentials.create(options)
      : await navigator.credentials.get(options);

    const ext = (credential as PublicKeyCredential).getClientExtensionResults() as any;
    const prfOutput = ext.prf?.results?.first as ArrayBuffer | undefined;

    // WebAuthn uspělo, ale PRF extension nepodporována
    if (!prfOutput) {
      return { ok: false, bucket: { type: "recoverable", reason: "prf-unsupported" } };
    }

    return {
      ok: true,
      prfOutput,
      credentialId: new Uint8Array((credential as PublicKeyCredential).rawId),
    };

  } catch (error) {
    const duration = performance.now() - start;
    return { ok: false, bucket: classifyWebAuthnError(error as DOMException, duration) };
  }
}
```

### 6.6 Integrace s Evolu init flow

```typescript
async function initEvoluEncryption(): Promise<EvoluKeys> {
  const storedCredId = loadCredentialId(); // z IndexedDB / localStorage

  // ── Attempt PRF ──
  const result = storedCredId
    ? await prfCeremony("get", buildGetOptions(storedCredId))
    : await prfCeremony("create", buildCreateOptions());

  if (result.ok) {
    if (!storedCredId) saveCredentialId(result.credentialId);
    return deriveEvoluKeys(result.prfOutput, result.credentialId);
  }

  // ── Handle failure ──
  switch (result.bucket.type) {
    case "expected":
      if (result.bucket.reason === "user-cancel") {
        // Uživatel zrušil → nabídni retry, pak fallback
        return retryOnceOrFallbackToMnemonic();
      }
      if (result.bucket.reason === "already-registered") {
        // Credential existuje → přepni na get
        return initEvoluEncryption(); // rekurze se storedCredId
      }
      return fallbackToMnemonic();

    case "recoverable":
      // PRF / env nedostupné → mnemonic
      console.info(`PRF unavailable: ${result.bucket.reason}`);
      return fallbackToMnemonic();

    case "bug":
      // Logovat pro debugging
      console.error("WebAuthn bug:", result.bucket.error);
      return fallbackToMnemonic();
  }
}
```

---

## 7. Credential persistence

Lokálně se ukládá **pouze metadata**, nikdy klíčový materiál:

```typescript
interface PrfCredentialMeta {
  credentialId: Uint8Array;  // pro allowCredentials v .get()
  createdAt: number;
  prfSupported: true;
}
```

Úložiště: IndexedDB (preferováno) nebo localStorage (jako fallback).
PRF output ani odvozené klíče se nikdy nepersistují — existují jen ephemérně v paměti.

---

## 8. AbortController lifecycle

Jedna WebAuthn ceremony najednou. Browser nepodporuje paralelní volání.

```typescript
let activeController: AbortController | null = null;

function abortActiveCeremony(): void {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
}

async function safeCeremony(options: PublicKeyCredentialRequestOptions) {
  abortActiveCeremony();
  activeController = new AbortController();

  try {
    return await navigator.credentials.get({
      publicKey: options,
      signal: activeController.signal,
    });
  } finally {
    activeController = null;
  }
}
```

Navigace, re-render, nebo nový ceremony pokus musí nejdříve zavolat `abortActiveCeremony()`.

---

## 9. Bezpečnostní model (threat analysis)

### 9.1 Co PRF garantuje

| Vlastnost | Garantováno? |
|---|:---:|
| Server / poskytovatel nikdy nevidí klíč | ✅ |
| Klíč nelze odvodit bez user verification (biometrika / PIN) | ✅ |
| Klíč je per-credential (per-device u HW authenticatorů) | ✅ |
| PRF output je deterministický pro stejný credential + salt | ✅ |
| Hardware izolace credential secret | ⚠️ závisí na TPM/SE |

### 9.2 Threat scenarios

| Hrozba | Dopad | Mitigace |
|---|---|---|
| Útočník získá šifrovanou DB (OPFS / sync relay) | Bez PRF output = bez klíče = AES-256 nečitelné | ✅ žádná akce |
| Útočník získá fyzické zařízení | Stále potřebuje UV (biometrii / PIN) | ✅ chráněno authenticatorem |
| Malware v prohlížeči (JS injection) | Může zachytit PRF output v paměti před šifrováním | ⚠️ mimo threat model WebAuthn (platí pro všechna web crypto řešení) |
| Platform sync (iCloud / Google PM) | Credential se přenese E2EE na jiné zařízení → stejný PRF output | ⚠️ user's explicit action — dokumentovat jako trusted device extension |
| Software authenticator (bez TPM/SE) | OS může teoreticky extrahovat credential secret | ⚠️ platform trust assumption — same as 1Password, GitHub |
| Ztráta všech zařízení | PRF output nelze rekonstruovat | Mnemonic recovery jako záloha |

### 9.3 Co nejde vynutit

Nelze vynutit, že authenticator používá TPM / Secure Enclave:

- `authenticatorAttachment: "platform"` → vynutí built-in authenticator, ale ne HW izolaci
- Attestation verification → technicky možné, ale browsery ji stripují z privacy důvodů
- Správný přístup: **dokumentovat předpoklad** v threat modelu (tak to dělá 1Password, GitHub, Dashlane)

---

## 10. Scope změn v Evolu

```
localAuth úpravy:
│
├── A. External key API (prerequisite, issue #537)
│    └── createEvolu({ externalOwner: { ownerId, writeKey, encryptionKey } })
│    └── Sdílený requirement s Trezor Suite
│
├── B. WebAuthn + PRF ceremony vrstva (nové)
│    ├── Registrace: navigator.credentials.create() s PRF extension
│    ├── Odemknutí: navigator.credentials.get() s PRF extension
│    ├── HKDF derivace tří Evolu klíčů z PRF output
│    └── AbortController lifecycle management
│
├── C. Error klasifikace (nové)
│    ├── classifyWebAuthnError() — 3 buckety + timing heuristika
│    ├── PRF output undefined detekce (WebAuthn OK, PRF ne)
│    └── Strukturované logování pro debugging
│
├── D. Fallback / recovery flow (rozšíření stávajícího)
│    ├── PRF nedostupné → mnemonic (stávající chování)
│    ├── PRF fail při odemknutí → retry → mnemonic
│    └── Mnemonic zůstává jako backup recovery
│
└── E. Credential metadata persistence (nové)
     ├── credentialId storage (IndexedDB)
     └── PRF capability flag
```

---

## 11. Reference

- [Corbado: Passkeys & WebAuthn PRF for E2EE (2026)](https://www.corbado.com/blog/passkeys-prf-webauthn) — PRF extension podpora, kompatibilita, authenticator kategorie
- [Corbado: Ultimate WebAuthn Errors in Production Guide (2026)](https://www.corbado.com/blog/webauthn-errors) — error taxonomie, timing heuristika, UX handling
- [W3C WebAuthn Level 3 — PRF Extension](https://www.w3.org/TR/webauthn-3/#prf-extension) — formální specifikace
- [Evolu Issue #537: Passing SLIP-21 keys directly](https://github.com/evoluhq/evolu/issues/537) — external key API (Trezor Suite)
- [Matthew Miller: Encrypting Data Using WebAuthn (2023)](https://blog.millerti.me/2023/01/22/encrypting-data-in-the-browser-using-webauthn/) — pionýrský článek o PRF + encryption
- [Levi Schuck: PRF WebAuthn (2023)](https://levischuck.com/blog/2023-02-prf-webauthn) — technické detaily implementace
- [Dashlane: PRF adoption for vault decryption](https://www.dashlane.com/blog/dashlane-phishing-resistance) — produkční case study
- [WebAuthn Issue #2062: New Error Codes](https://github.com/w3c/webauthn/issues/2062) — návrh na granularnější chybové kódy (zatím neimplementováno)
