# Synchronizace passkeys

Uživatel si může při vytváření passkey vybrat, kam ho uloží (to nelze ovlivnit/vynutit ze strany vývojáře):
1. **Synced passkeys** přes platformní password manager (iCloud Keychain, Google Password Manager, Microsoft Password Manager) nebo password manager třetí strany (1Password, Bitwarden)
2. **Device-bound passkeys** přes externí HW klíč (Trezor, YubiKey) nebo Windows Hello 
___

- `PRF_output = HMAC-SHA-256(credential_secret, eval_input)`
    - `credential_secret` - symetrický klíč svázaný s passkey
    - `eval_input` - context string, dodává aplikace pro odlišení výstupu
- Výstup z PRF funkce používáme jako šifrovací klíč pro lokální DB se seznamem Ownerů
- U Synced passkeys se `credential_secret` synchronizuje mezi zařízeními, tudíž výsledek PRF funkce bude na každém zařízení totožný
    - Tato synchronizace údajně probíhá E2EE, takže by ke klíčům poskytovatel neměl mít přístup
    - Implementace se liší dle platformy

### iCloud Keychain
- Relativně dobře zdokumentované a transparentní
- Princip **circle of trust** - každé zařízení drží veřejné klíče všech ostatních
- Nové zařízení si vygeneruje sadu klíčů a požádá jiné důvěryhodné o vstup do kruhu
- Je to v podstatě P2P, `credential_secret` se šifruje veřejným klíčem cílového zařízení

### Google Password Manager a Microsoft Password Manager
- Oba mají podobnou implementaci, centralizovaný model kde se server účastní odvozování klíče
- Klíč, kterým se šifruje `credential_secret` je kombinace server-secretu a uživatelského PINu (6 číslic = 20 bitů entropie)
- Na PIN server nevidí; a jeho zadáním na dalším zařízení se získá stejný šifrovací klíč kterým se poté rozšifruje `credential_secret`
- Bezpečnost tedy stojí na server-secretu, údajně se používají různé mechanismy pro jeho ochranu (je v Azure Managed HSM, uvolnitelný jen do attestovaného TEE (Confidential Containers), čítač pokusů zadání PINu - max 10)
    - Pokud se někdo dostane k server-secretu, mohl by brute-forcnout všechny kombinace PINu (s tak malou entropií triviální)
- Méně transparentní než Apple, nevíme jak to přesně funguje

### Windows Hello
- Passkey je vázán na hardware (uložen v TPM), nelze ho exportovat, neexistuje synchronizace
- Historická možnost, dnes už Microsoft dává na výběr mezi synced klíči přes Microsoft Password Manager nebo device-bound přes Windows Hello

# Závěr

U synced passkeys tedy může existovat riziko, že se poskytovatel služby dostane ke `credential_secret` – ale i kdyby se mu to povedlo, neměl by to být problém, jelikož stále nemá přístup k samotné DB