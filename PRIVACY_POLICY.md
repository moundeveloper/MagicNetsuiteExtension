# Privacy Policy — Magic NetSuite

**Ultimo aggiornamento:** 28 luglio 2026

## Scopo dell'estensione

Magic NetSuite è un ambiente di sviluppo e amministrazione per NetSuite. Offre strumenti per SuiteScript, SuiteQL, record, log, File Cabinet, template PDF, SDF e flussi assistiti da modelli AI.

## Dati trattati

L'estensione tratta i dati necessari alla funzionalità scelta dall'utente:

- **Preferenze:** scorciatoie, funzionalità preferite, provider selezionato, account preferito e altre impostazioni non segrete.
- **Credenziali opzionali:** token GitHub Copilot e chiavi OpenRouter inseriti dall'utente.
- **Dati NetSuite:** record, script, query, log, file, template, metadati e risultati richiesti tramite la sessione NetSuite autenticata dell'utente.
- **Contenuti di lavoro locali:** query, cronologia delle versioni, note, workspace, snapshot, attività, conversazioni e configurazioni degli agenti.
- **Feedback opzionale:** identificatore casuale dell'installazione, titolo, descrizione, categoria e stato delle richieste inviate dalla schermata Feedback.
- **Sessione browser opzionale:** quando viene abilitata l'automazione Playwright, lo stato browser può includere cookie di sessione NetSuite.

L'estensione non vende dati e non include pubblicità o tracciamento pubblicitario.

## Dove vengono memorizzati i dati

- `chrome.storage.sync` conserva e sincronizza tramite Chrome le preferenze non segrete.
- `chrome.storage.local`, `localStorage` e IndexedDB conservano localmente credenziali, workspace, cronologie, snapshot, note e altri dati di lavoro.
- `chrome.storage.session` conserva stato temporaneo necessario alla comunicazione tra pannello, schede e service worker.
- Il native host e gli strumenti MCP possono scrivere configurazioni, log diagnostici e file di stato sul computer dell'utente.
- Se l'utente abilita la persistenza Playwright, lo stato browser viene salvato nel profilo locale Magic NetSuite. L'utente deve proteggere il proprio account del sistema operativo e cancellare questo stato quando non è più necessario.

Le credenziali AI non vengono memorizzate in `chrome.storage.sync`. Le installazioni precedenti vengono migrate automaticamente allo storage locale.

## Comunicazioni esterne

Magic NetSuite comunica con servizi esterni solo quando necessario per una funzione scelta o configurata dall'utente:

### NetSuite

Le richieste verso i domini NetSuite usano la sessione autenticata dell'utente. NetSuite applica ruolo, permessi e policy dell'account corrente.

### Provider AI opzionali

Quando l'utente sceglie un provider remoto, prompt, contesto selezionato, output degli strumenti e contenuti necessari alla richiesta possono essere inviati al provider:

- **OpenRouter**, tramite la relativa API;
- **GitHub Copilot**, tramite i servizi GitHub Copilot.

Ollama e OpenCode possono essere configurati con endpoint locali o personalizzati. In questo caso i dati vengono inviati all'indirizzo configurato dall'utente. Le policy, la conservazione e l'eventuale uso dei dati da parte del provider sono disciplinati dal provider scelto.

Magic NetSuite non invia automaticamente l'intero account NetSuite a un provider AI. Tuttavia, i dati inclusi esplicitamente nel prompt o recuperati dagli strumenti durante una conversazione possono essere trasmessi al provider attivo.

### Feedback

La schermata Feedback usa un progetto Supabase configurato dal publisher. Invia un identificatore casuale dell'installazione e il contenuto della richiesta. Non inviare credenziali, dati personali, record NetSuite o informazioni riservate nel testo del feedback.

### MCP e native host

La comunicazione tra estensione e native host avviene localmente. Il server HTTP MCP usa l'interfaccia loopback per impostazione predefinita. Un'esposizione di rete richiede configurazione esplicita e autenticazione tramite token.

## Finalità

I dati vengono usati per:

1. eseguire le funzionalità richieste;
2. mantenere preferenze, workspace e cronologie;
3. comunicare con il provider AI scelto;
4. eseguire automazioni locali tramite native host, MCP o Playwright;
5. ricevere e gestire feedback inviato volontariamente;
6. diagnosticare errori quando l'utente abilita esplicitamente funzioni diagnostiche.

## Conservazione e cancellazione

- I dati locali persistono fino alla cancellazione dall'interfaccia, alla rimozione manuale o alla disinstallazione dell'estensione.
- I dati di `chrome.storage.session` vengono eliminati da Chrome al termine della sessione.
- I dati sincronizzati seguono le regole di Chrome Sync.
- I dati inviati a NetSuite, provider AI, GitHub o Supabase seguono le rispettive policy e configurazioni.
- La disinstallazione rimuove i dati dell'estensione gestiti da Chrome, ma può non rimuovere file creati dal native host o profili Playwright. Questi devono essere cancellati separatamente.

## Autorizzazioni Chrome

| Autorizzazione | Utilizzo |
| --- | --- |
| `sidePanel` | Interfaccia principale |
| `clipboardWrite` | Copia di codice, risultati e immagini |
| `tabs`, `tabGroups`, `activeTab` | Individuazione dell'account NetSuite e gestione delle schede di lavoro |
| `storage`, `unlimitedStorage` | Preferenze e dati di lavoro locali |
| `scripting` | Esecuzione delle integrazioni richieste nelle pagine NetSuite |
| `cookies`, `debugger` | Automazioni avanzate abilitate dall'utente |
| `downloads` | Esportazione di file, report e progetti |
| `declarativeNetRequest`, `webRequest` | Ispezione e compatibilità delle richieste NetSuite |
| `nativeMessaging` | Comunicazione con il native host locale |
| Permessi host NetSuite | Accesso alle funzionalità NetSuite richieste |
| Permesso host Supabase | Invio e lettura del feedback opzionale |

## Scelte dell'utente

L'utente può:

- scegliere un provider locale invece di uno remoto;
- cancellare token e chiavi dalle Impostazioni;
- disabilitare MCP, Flight Recorder e altre funzioni diagnostiche;
- eliminare cronologie, workspace, note e snapshot dalle rispettive schermate;
- non utilizzare la schermata Feedback;
- rimuovere l'estensione e cancellare separatamente i file del native host/Playwright.

## Modifiche

Le modifiche a questa policy vengono pubblicate insieme a una nuova versione dell'estensione.

## Contatti

Per richieste relative a privacy, cancellazione o sicurezza, usare il contatto del publisher indicato nella pagina di distribuzione dell'estensione.
