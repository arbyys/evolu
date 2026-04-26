# PRF extension - dostupnost

Aby ve WebAuthn fungovala PRF extension, musí platit:
- authenticator podporuje `hmac-secret`
- OS to umí zprostředkovat browseru
- browser implementuje PRF extension ve svém WebAuthn API

___

### Kde to funguje bez problémů
- Android 9+
    - Chrome / Edge
- iOS 18.4+
    - Chrome / Safari / Firefox
- macOS 15+
    - Chrome 132+ / Safari 18+ / Firefox 139+
- Windows 11 25H2 (Únor 2026+)
    - Chrome 147+ / Edge 147+ / Firefox 148+

### Kde to nefunguje vůbec
- Android
    - Firefox jakékoliv verze neumí PRF
- Windows 10
    - OS neumí `hmac-secret`
- Windows 11 před 25H2 updatem
    - Windows Hello neumí `hmac-secret`
- U libovolného OS
    - Chrome nabízí uložení passkey přímo do Chrome profilu (Chrome Profile authenticator) a ten vůbec nepodporuje PRF
    - Tor / ostatní privacy browsery mají WebAuthn většinou zakázány

### Kdy to funguje, ale s nějakým chytákem
- Windows 11 25H2 (Únor 2026+)
    - Chrome ≤ 146 / Edge ≤ 146
        - Výstup z PRF je dostupný až při `get()`, nikoliv rovnou při `create()` — nutné vyvolat dva dialogy
- macOS 26.4
    - Safari + externí USB klíč
        - Bug - Vrací rovnou raw výstup `hmac-secret` místo aby ho prohnal PRF derivací, výsledky pak nejsou interoperable s jinými browsery (WebKit bug 311099)
- iOS 18.0–18.3
    - Libovolný browser + cross-device auth
        - Bug - PRF vrací jiný output při cross-device autentizaci než při lokální, což vede ke ztrátě dat pokud se klíč použije k šifrování (WebKit bug 259934)
- U libovolného OS
    - Starší externí USB s CTAP 2.0
        - PRF je dostupné jen pokud byl nastaven jako flag při `create()`, jinak je undefined 
        - (CTAP 2.1+ už umí používat PRF nezávisle na tom, jestli byl při registraci klíče nastaven flag, což umožňuje používat retrospektivně registrované klíče)
    - Starší externí USB s CTAP 2.0/2.1
        - Výstup z PRF je dostupný až při `get()`, nikoliv rovnou při `create()` — nutné vyvolat dva dialogy

### Závěr
- Cca 85-90% uživatelů má přístup k PRF, cca 10-15% nemá (odhad LLM)
- Firefox Android, Win10, neaktualizovaný Win11 a některé okrajové browsery by tedy spadly do memory-only módu
- Většina z uvedených chytáků nemá pro Evolu zásadní dopad (některé spadnou do memory-only módu), jen je potřeba po volání `create()` zkontrolovat `prf.enabled` a pokud PRF output chybí, ještě zavolat navíc `get()`

___

# PRF extension - detekce dostupnosti

Přímá detekce bohužel neexistuje, lze udělat následující flow:

### 1. `getClientCapabilities()` (tichá, žádný dialog)
```typescript
const caps = await PublicKeyCredential.getClientCapabilities();
// caps["extension:prf"] === true
//     → browser umí PRF zpracovat
```
- Chrome 133+, Safari 18+, Firefox 135+
- Říká nám jen to, že browser umí PRF požadavek zpracovat, **nikoliv že ho také authenticator podporuje**
  - Např. Chrome na Windows 11 před 25H2 aktualizací vrátí `true`, ale Windows Hello nemá hmac-secret
- Pokud vrátí `false`, automaticky padáme do memory-only módu

### 2. Skutečná ceremony (vyvolá dialog)
```typescript
const credential = await navigator.credentials.create({
  publicKey: {
    // ... options
    extensions: { prf: { eval: { first: eval_input } } }
  }
});
const ext = credential.getClientExtensionResults();

if (ext.prf?.results?.first) {
  // PRF funguje (CTAP 2.2)
} else if (ext.prf?.enabled) {
  // PRF bude fungovat až při get(), ale create() ho nevrátil (CTAP 2.0/2.1)
} else {
  // PRF nedostupné
}
```
- Prostě se pokusíme provést skutečnou registraci passkey a až poté zpětně vyhodnotíme, jestli je PRF dostupné
- Trošku divné UX pokud si uživatel zaregistruje passkey, poté se detekuje že PRF není podporované a spadne to do memory-only módu

### `isUserVerifyingPlatformAuthenticatorAvailable()`
```typescript
const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
``` 
- Pokud `false` → žádný platform authenticator, PRF přes platform auth nepůjde
- Původně jsem myslel, že bychom to mohli použít společně s prvním krokem jako další detekci, že PRF není dostupná
    - Tohle ovšem bere v potaz pouze platform authenticator – uživatel ale může mít externí USB authenticator, který by PRF uměl → tohle by ho vyřadilo
    - Proto se to pro Evolu nehodí, museli bychom se omezit jen na platform authenticatory