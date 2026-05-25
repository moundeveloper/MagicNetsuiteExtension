# Privacy Policy — Magic NetSuite

**Ultimo aggiornamento:** 25 maggio 2026

## Scopo dell'estensione

Magic NetSuite è un'estensione Chrome progettata come ambiente di sviluppo integrato (IDE) per la piattaforma NetSuite. Assiste sviluppatori e amministratori NetSuite nella scrittura ed esecuzione di codice SuiteScript, nell'esecuzione di query SuiteQL, nella gestione di script e File Cabinet, e nell'ispezione di record.

## Raccolta dei dati

Questa estensione raccoglie esclusivamente i dati necessari al suo funzionamento:

### Dati raccolti automaticamente

- **Preferenze utente**: impostazioni di configurazione dell'estensione salvate tramite `chrome.storage.sync` (shortcut, preferenze account, toggle funzionalità). Questi dati vengono sincronizzati automaticamente da Chrome tramite l'account Google dell'utente.
- **Stato della sessione**: dati temporanei salvati in `chrome.storage.session` per la comunicazione tra componenti dell'estensione.

### Dati a cui l'utente concede esplicitamente accesso

- **Dati NetSuite**: quando l'utente utilizza l'estensione su pagine NetSuite, questa può leggere e scrivere dati all'interno della sessione NetSuite dell'utente (record, script, query SuiteQL, File Cabinet). L'estensione opera esclusivamente nell'ambito della sessione autenticata dell'utente su NetSuite.

## Utilizzo dei dati

I dati raccolti vengono utilizzati esclusivamente per:

1. Fornire le funzionalità dell'estensione (editor SuiteScript, Query SuiteQL, gestione script, File Cabinet, ispezione record)
2. Salvare le preferenze utente tra le sessioni
3. Abilitare l'assistente AI tramite comunicazione locale con un native host MCP

## Condivisione dei dati

**Nessun dato viene condiviso con terze parti.**

- L'estensione comunica solo con:
  - I server NetSuite (`*.app.netsuite.com`) autorizzati dall'utente tramite la sua sessione autenticata
  - Un'applicazione nativa locale (`com.magicnetsuite.mcp_bridge`) installata dall'utente per la funzionalità AI assistant — la comunicazione avviene esclusivamente in locale tramite named pipe
- Non vengono inviati dati a server esterni, servizi di analytics, o piattaforme pubblicitarie
- Non vengono raccolti dati personali identificativi (nome, email, indirizzo) al di fuori della sessione NetSuite dell'utente

## Archiviazione e conservazione

- I dati utente sono memorizzati localmente nel browser tramite `chrome.storage.sync` e `chrome.storage.session`
- I dati di sessione vengono cancellati automaticamente alla chiusura del browser
- Le preferenze utente persistono finché l'utente non le modifica o disinstalla l'estensione
- La disinstallazione dell'estensione rimuove tutti i dati associati

## Autorizzazioni Chrome

L'estensione richiede le seguenti autorizzazioni, ciascuna giustificata dal singolo scopo:

| Autorizzazione | Motivazione |
|----------------|-------------|
| `sidePanel` | Interfaccia utente principale dell'estensione |
| `clipboardWrite` | Copia di codice SuiteScript e risultati query |
| `tabs` | Gestione schede e comunicazione con content script |
| `storage` | Salvataggio preferenze utente e stato sessione |
| `activeTab` | Accesso alla scheda attiva su interazione utente |
| `declarativeNetRequest` | Intercettazione risposte HTTP NetSuite per ispezione |
| `host_permissions` (`*.app.netsuite.com`) | Accesso ai domini NetSuite per le API |
| `nativeMessaging` | Comunicazione con native host MCP per AI assistant |
| `clipboardRead` (iframe) | Lettura appunti nell'interfaccia utente |

## Modifiche alla privacy policy

Eventuali modifiche a questa privacy policy verranno pubblicate su questa pagina. L'utente sarà notificato tramite aggiornamento dell'estensione.

## Contatti

Per domande relative alla privacy o al trattamento dei dati, contattare l'indirizzo email del publisher indicato nella pagina del Chrome Web Store.
