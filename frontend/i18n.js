// StampDAG — minimal in-house i18n (no library, no build step, matches the rest of
// this project's vanilla-JS convention). Exposes window.I18N = { t, setLang,
// getLang, formatDate, formatDateTime, onChange }.
(function () {
  'use strict';

  const STRINGS = {
    de: {
      brandTitle: 'StampDAG',
      brandTagline: 'Proof of Existence auf der Kaspa BlockDAG',
      pageTitleIndex: 'StampDAG — Digitaler Dokumenten-Zeitstempel',
      metaDescriptionIndex: 'Verankere den SHA-256-Hash eines Dokuments (PDF, Bild oder Word) fälschungssicher auf der Kaspa BlockDAG.',
      navAnchor: 'Verankern',
      navVerify: 'Verifizieren',
      navHistory: 'Verlauf',
      footerDisclaimer: 'StampDAG ist ein technischer Zeitstempel-Nachweis, kein Ersatz für notarielle Beurkundung.',
      footerAbout: 'Wie funktioniert das?',
      footerSecurity: 'Sicherheit & Transparenz',
      homeStats: '{{count}} Dokumente verankert · zuletzt am {{date}}',
      homeStatsEmpty: 'Noch keine Verankerungen — sei die erste.',

      walletLoginBtn: 'Mit Wallet anmelden',
      walletInstall: 'Kasware installieren ↗',
      walletLogout: 'Abmelden',
      walletConnecting: 'Verbinde…',
      walletLoginFailed: 'Wallet-Login fehlgeschlagen: {{msg}}',
      payerNotePlatform: 'Gebühr wird von <strong>StampDAG</strong> übernommen.',
      payerNoteSelf: 'Gebühr wird aus deiner Wallet bezahlt (<strong>{{address}}</strong>).',
      anchoringSelf: 'Warte auf Wallet-Bestätigung…',
      selfAnchorFailed: 'Eigenzahlung fehlgeschlagen: {{msg}}',

      dropzoneTitle: 'Dokument hierher ziehen',
      dropzoneSub: 'oder klicken zum Auswählen',
      dropzonePrivacy: 'Der Dokumenteninhalt verlässt niemals deinen Browser — nur der Hash wird gesendet.',
      dropzoneFormats: 'PDF, Bilder (JPG, PNG, WebP), Word (DOCX, DOC)',
      hashLabel: 'SHA-256 Hash',
      anchorBtn: 'Auf Kaspa BlockDAG verankern',
      anchoring: 'Wird verankert…',
      statusLabel: 'Status',
      txidLabel: 'Transaktions-ID',
      explorerLink: 'Im Explorer ansehen ↗',
      certLink: 'Zertifikat herunterladen ↓',
      invalidFileType: 'Bitte ein unterstütztes Dokument auswählen (PDF, Bild oder Word).',
      anchorFailed: 'Verankerung fehlgeschlagen: {{msg}}',

      tabUpload: 'Dokument hochladen',
      tabManual: 'Hash / TXID eingeben',
      verifyManualLabel: 'SHA-256 Hash oder Transaktions-ID',
      verifyManualPlaceholder: 'z. B. a1b2c3... oder Kaspa TXID',
      verifyBtn: 'Prüfen',
      verifying: 'Wird geprüft…',
      matchTitle: '✓ Übereinstimmung gefunden',
      matchBody: 'Verankert am {{date}}, TXID {{txid}} — Status: {{status}}',
      noMatchTitle: '✕ Keine Übereinstimmung',
      noMatchBody: 'Für diesen Hash bzw. diese TXID wurde keine Verankerung gefunden.',
      verifyError: 'Fehler: {{msg}}',

      historyIntro: 'Dieser Verlauf wird nur lokal in deinem Browser gespeichert. Er ist eine reine Komfortfunktion — der eigentliche Nachweis liegt immer auf der Kaspa BlockDAG und lässt sich jederzeit über Hash oder Transaktions-ID erneut abrufen, auch wenn dieser Verlauf gelöscht wird.',
      historyEmpty: 'Noch keine Verankerungen auf diesem Gerät.',
      unnamedDoc: 'Unbenanntes Dokument',
      recheckLink: 'Status prüfen',
      explorerShort: 'Explorer ↗',
      certShort: 'Zertifikat ↓',
      recheckFailed: 'Status konnte nicht geprüft werden: {{msg}}',

      statusPending: 'Ausstehend',
      statusConfirmed: 'Bestätigt',
      statusFailed: 'Fehlgeschlagen',

      pageTitleAbout: 'Wie StampDAG funktioniert',
      aboutHeroTitle: 'Ein Zeitstempel, der auf der Blockchain lebt',
      aboutHeroBody: 'StampDAG verankert den digitalen Fingerabdruck (Hash) eines Dokuments auf der Kaspa BlockDAG — fälschungssicher, öffentlich überprüfbar, und ohne dass der Inhalt deines Dokuments jemals einen Server erreicht.',
      howItWorksTitle: 'So funktioniert es',
      step1t: 'Dokument auswählen', step1d: 'PDF, Bild oder Word-Datei per Drag & Drop oder Dateiauswahl.',
      step2t: 'Hash lokal berechnen', step2d: 'Dein Browser berechnet einen SHA-256-Hash — einen eindeutigen digitalen Fingerabdruck. Die Datei selbst verlässt niemals deinen Rechner.',
      step3t: 'Auf der Kaspa BlockDAG verankern', step3d: 'Nur der Hash wird in eine Kaspa-Transaktion eingebettet — dauerhaft, öffentlich und unveränderlich gespeichert.',
      step4t: 'Zertifikat erhalten', step4d: 'Ein PDF-Zertifikat mit QR-Code, Transaktions-ID und Zeitstempel dient als Nachweisdokument.',
      step5t: 'Jederzeit unabhängig verifizierbar', step5d: 'Jede Person kann später dasselbe Dokument hochladen oder den Hash eingeben, um die Verankerung zu bestätigen — auch ohne StampDAG-Account, sogar über einen unabhängigen Kaspa-Explorer.',
      whyTitle: 'Wofür ist das nützlich?',
      uc1t: 'Kaufverträge & Angebote', uc1d: 'Belege, welche exakte Fassung eines Vertrags oder Angebots zu welchem Zeitpunkt verschickt wurde.',
      uc2t: 'Geistiges Eigentum', uc2d: 'Zeitstempel für Designs, Musik, Texte oder Fotos, bevor sie veröffentlicht oder gepitcht werden.',
      uc3t: 'NDAs & Vertraulichkeit', uc3d: 'Verankere den genauen Inhalt einer Vereinbarung vor Verhandlungen mit Investoren oder Partnern.',
      uc4t: 'Compliance-Stände', uc4d: 'Belege, welche Fassung einer Richtlinie oder Arbeitsanweisung zu welchem Zeitpunkt galt.',
      uc5t: 'Testament- & Vollmacht-Entwürfe', uc5d: 'Zeitstempel für einen Entwurf vor dem Gang zum Notar — als Ergänzung, nicht Ersatz der notariellen Form.',
      uc6t: 'Vereinbarungen unter Privatpersonen', uc6d: 'Zeitliche Verankerung informeller Abmachungen zwischen Freunden oder Familie.',
      legalTitle: 'Rechtlicher Hinweis',
      legalText: '„StampDAG“ ersetzt keinen amtlich bestellten Notar und keine notarielle Beurkundung im Sinne des deutschen Beurkundungsgesetzes. Das System erbringt einen technischen Existenz- und Zeitstempel-Nachweis (Proof of Existence), vergleichbar mit einem digitalen Poststempel. Für rechtsverbindliche Beglaubigungen, öffentliche Urkunden oder Willenserklärungen mit Formzwang (z. B. Grundstücksverträge, Eheverträge) bleibt ein realer Notar erforderlich.',
      backToApp: '← Zurück zur App',

      pageTitleSecurity: 'Sicherheit & Transparenz — StampDAG',
      secHeroTitle: 'Vertrau nicht uns — prüf es selbst',
      secHeroBody: 'StampDAG ist so gebaut, dass du dem Dienst so wenig wie möglich vertrauen musst. Hier steht im Detail, was das technisch bedeutet.',
      secPrinciplesTitle: 'Grundprinzipien',
      secP1t: 'Dein Dokument verlässt nie den Browser',
      secP1d: 'Der SHA-256-Hash wird lokal in deinem Browser berechnet (Web Crypto API). Der Dokumentinhalt selbst wird niemals an unsere Server oder Dritte übertragen — das kannst du in den Netzwerk-Anfragen deines Browsers selbst nachprüfen.',
      secP2t: 'Unabhängig nachprüfbar, ohne uns zu fragen',
      secP2d: 'Jede Verankerung liegt öffentlich auf der Kaspa BlockDAG. Du kannst jede Transaktion über einen beliebigen, unabhängigen Kaspa-Explorer einsehen — auch falls StampDAG einmal offline wäre, bleibt der Nachweis bestehen.',
      secP3t: 'Offenes, dokumentiertes Payload-Format',
      secP3d: 'Jede Verankerung trägt exakt 36 Bytes: das 4-Byte-Kürzel „KN01" gefolgt vom rohen 32-Byte-SHA-256-Hash. Jede dritte Partei kann eine Verankerung direkt aus den Chain-Daten auslesen, ohne unserem Backend zu vertrauen.',
      secP4t: 'Kein Zugriff auf deinen privaten Schlüssel',
      secP4d: 'Meldest du dich mit deiner eigenen Wallet an (Kasware), signierst und bezahlst du die Verankerung selbst in deiner Wallet-Erweiterung. StampDAG sieht und speichert deinen privaten Schlüssel oder deine Seed-Phrase zu keinem Zeitpunkt.',
      secP5t: 'Offener Quellcode',
      secP5d: 'Der komplette Quellcode ist öffentlich einsehbar — jeder kann nachlesen, was der Dienst tatsächlich tut, statt uns glauben zu müssen. <a href="https://github.com/hillo1989/stampdag" target="_blank" rel="noopener">Repository auf GitHub ↗</a>',
      secOpsTitle: 'Betrieb',
      secOpsBody: 'Ratenbegrenzung schützt vor Missbrauch, Zugangsdaten und Wallet-Schlüssel werden verschlüsselt und mit eingeschränkten Dateizugriffsrechten gespeichert, und der Code wird regelmäßig auf Sicherheitsprobleme überprüft.',
      secStatsTitle: 'Live-Status',
      secStatsBody: '{{count}} Dokumente verankert — zuletzt bestätigt am {{date}}.',
      secStatsError: 'Live-Status momentan nicht abrufbar.',
    },
    en: {
      brandTitle: 'StampDAG',
      brandTagline: 'Proof of Existence on the Kaspa BlockDAG',
      pageTitleIndex: 'StampDAG — Digital Document Timestamp',
      metaDescriptionIndex: 'Anchor the SHA-256 hash of a document (PDF, image, or Word) tamper-proof on the Kaspa BlockDAG.',
      navAnchor: 'Anchor',
      navVerify: 'Verify',
      navHistory: 'History',
      footerDisclaimer: 'StampDAG is a technical timestamp proof, not a substitute for notarization.',
      footerAbout: 'How does this work?',
      footerSecurity: 'Security & Transparency',
      homeStats: '{{count}} documents anchored · last on {{date}}',
      homeStatsEmpty: 'No anchors yet — be the first.',

      walletLoginBtn: 'Log in with wallet',
      walletInstall: 'Install Kasware ↗',
      walletLogout: 'Log out',
      walletConnecting: 'Connecting…',
      walletLoginFailed: 'Wallet login failed: {{msg}}',
      payerNotePlatform: 'Fee is covered by <strong>StampDAG</strong>.',
      payerNoteSelf: 'Fee is paid from your wallet (<strong>{{address}}</strong>).',
      anchoringSelf: 'Waiting for wallet confirmation…',
      selfAnchorFailed: 'Self-pay anchoring failed: {{msg}}',

      dropzoneTitle: 'Drag document here',
      dropzoneSub: 'or click to choose',
      dropzonePrivacy: 'The document content never leaves your browser — only the hash is sent.',
      dropzoneFormats: 'PDF, images (JPG, PNG, WebP), Word (DOCX, DOC)',
      hashLabel: 'SHA-256 Hash',
      anchorBtn: 'Anchor on the Kaspa BlockDAG',
      anchoring: 'Anchoring…',
      statusLabel: 'Status',
      txidLabel: 'Transaction ID',
      explorerLink: 'View in explorer ↗',
      certLink: 'Download certificate ↓',
      invalidFileType: 'Please choose a supported document (PDF, image, or Word).',
      anchorFailed: 'Anchoring failed: {{msg}}',

      tabUpload: 'Upload document',
      tabManual: 'Enter hash / TXID',
      verifyManualLabel: 'SHA-256 hash or transaction ID',
      verifyManualPlaceholder: 'e.g. a1b2c3... or Kaspa TXID',
      verifyBtn: 'Check',
      verifying: 'Checking…',
      matchTitle: '✓ Match found',
      matchBody: 'Anchored on {{date}}, TXID {{txid}} — status: {{status}}',
      noMatchTitle: '✕ No match',
      noMatchBody: 'No anchor was found for this hash or transaction ID.',
      verifyError: 'Error: {{msg}}',

      historyIntro: 'This history is stored only locally in your browser. It is a pure convenience feature — the actual proof always lives on the Kaspa BlockDAG and can be looked up again at any time via hash or transaction ID, even if this history is cleared.',
      historyEmpty: 'No anchors on this device yet.',
      unnamedDoc: 'Untitled document',
      recheckLink: 'Check status',
      explorerShort: 'Explorer ↗',
      certShort: 'Certificate ↓',
      recheckFailed: 'Could not check status: {{msg}}',

      statusPending: 'Pending',
      statusConfirmed: 'Confirmed',
      statusFailed: 'Failed',

      pageTitleAbout: 'How StampDAG works',
      aboutHeroTitle: 'A timestamp that lives on the blockchain',
      aboutHeroBody: 'StampDAG anchors the digital fingerprint (hash) of a document on the Kaspa BlockDAG — tamper-proof, publicly verifiable, and without your document’s content ever reaching a server.',
      howItWorksTitle: 'How it works',
      step1t: 'Choose a document', step1d: 'PDF, image, or Word file — drag & drop or pick a file.',
      step2t: 'Hash it locally', step2d: 'Your browser computes a SHA-256 hash — a unique digital fingerprint. The file itself never leaves your machine.',
      step3t: 'Anchor it on the Kaspa BlockDAG', step3d: 'Only the hash is embedded in a Kaspa transaction — stored permanently, publicly, and immutably.',
      step4t: 'Get a certificate', step4d: 'A PDF certificate with a QR code, transaction ID, and timestamp serves as your proof document.',
      step5t: 'Verify independently, anytime', step5d: 'Anyone can later upload the same document or enter the hash to confirm the anchor — no StampDAG account needed, even via an independent Kaspa explorer.',
      whyTitle: 'What is this useful for?',
      uc1t: 'Purchase contracts & offers', uc1d: 'Prove exactly which version of a contract or offer was sent, and when.',
      uc2t: 'Intellectual property', uc2d: 'Timestamp designs, music, writing, or photos before they’re published or pitched.',
      uc3t: 'NDAs & confidentiality', uc3d: 'Anchor the exact content of an agreement before talks with investors or partners.',
      uc4t: 'Compliance records', uc4d: 'Prove which version of a policy or procedure was in effect at a given time.',
      uc5t: 'Will & power-of-attorney drafts', uc5d: 'Timestamp a draft before visiting a notary — a supplement, not a substitute, for notarization.',
      uc6t: 'Agreements between individuals', uc6d: 'Time-anchor informal arrangements between friends or family.',
      legalTitle: 'Legal notice',
      legalText: '"StampDAG" does not replace a licensed notary or notarization under German notarization law (Beurkundungsgesetz). The system provides a technical proof of existence and timestamp, comparable to a digital postmark. A real notary remains required for legally binding certifications, public deeds, or declarations subject to formal requirements (e.g. real estate contracts, marriage contracts). This English text is a plain translation for convenience — the German original is the authoritative legal wording.',
      backToApp: '← Back to the app',

      pageTitleSecurity: 'Security & Transparency — StampDAG',
      secHeroTitle: "Don't trust us — verify it yourself",
      secHeroBody: 'StampDAG is built so you need to trust the service as little as possible. Here is exactly what that means, technically.',
      secPrinciplesTitle: 'Core principles',
      secP1t: 'Your document never leaves the browser',
      secP1d: 'The SHA-256 hash is computed locally in your browser (Web Crypto API). The document content itself is never sent to our servers or any third party — you can verify this yourself in your browser\'s network requests.',
      secP2t: 'Independently verifiable, without asking us',
      secP2d: 'Every anchor lives publicly on the Kaspa BlockDAG. You can look up any transaction via any independent Kaspa explorer — even if StampDAG were ever offline, the proof still stands.',
      secP3t: 'Open, documented payload format',
      secP3d: 'Every anchor carries exactly 36 bytes: the 4-byte marker "KN01" followed by the raw 32-byte SHA-256 hash. Any third party can read an anchor straight off the chain data without trusting our backend.',
      secP4t: 'No access to your private key',
      secP4d: 'If you log in with your own wallet (Kasware), you sign and pay for the anchor yourself, inside your wallet extension. StampDAG never sees or stores your private key or seed phrase.',
      secP5t: 'Open source code',
      secP5d: 'The complete source code is publicly viewable — anyone can read exactly what the service does, instead of having to take our word for it. <a href="https://github.com/hillo1989/stampdag" target="_blank" rel="noopener">Repository on GitHub ↗</a>',
      secOpsTitle: 'Operations',
      secOpsBody: 'Rate limiting protects against abuse, credentials and wallet keys are encrypted at rest with restricted file permissions, and the code is reviewed regularly for security issues.',
      secStatsTitle: 'Live status',
      secStatsBody: '{{count}} documents anchored — last confirmed on {{date}}.',
      secStatsError: 'Live status is currently unavailable.',
    },
  };

  const LANG_KEY = 'stampdag_lang';
  function detectDefaultLang() {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'de' || saved === 'en') return saved;
    return (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  let currentLang = detectDefaultLang();
  const listeners = [];

  function t(key, vars) {
    let str = (STRINGS[currentLang] && STRINGS[currentLang][key]) || STRINGS.de[key] || key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp('{{' + k + '}}', 'g'), vars[k]);
      });
    }
    return str;
  }

  function applyStaticDom() {
    document.documentElement.lang = currentLang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.innerHTML = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(',').forEach((pair) => {
        const [attr, key] = pair.split(':');
        el.setAttribute(attr, t(key));
      });
    });
    if (document.title && document.body.dataset.titleKey) {
      document.title = t(document.body.dataset.titleKey);
    }
  }

  function setLang(lang) {
    if (lang !== 'de' && lang !== 'en') return;
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    applyStaticDom();
    listeners.forEach((fn) => fn(lang));
  }

  function getLang() {
    return currentLang;
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function formatDate(iso, opts) {
    if (!iso) return '—';
    const locale = currentLang === 'de' ? 'de-DE' : 'en-US';
    return new Date(iso).toLocaleString(locale, opts || { dateStyle: 'medium', timeStyle: 'short' });
  }

  document.addEventListener('DOMContentLoaded', applyStaticDom);

  window.I18N = { t, setLang, getLang, onChange, formatDate, LANGS: ['de', 'en'] };
})();
