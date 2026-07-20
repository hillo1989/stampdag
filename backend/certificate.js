// Generates a downloadable PDF timestamp certificate (F-05): hash, TXID, status,
// a QR code linking back to the public verify view, and the legal disclaimer from
// the Lastenheft section 1.3 (in German and English, §4 i18n). Regenerated fresh on
// every request — never stored — so the confirmation status shown is always current.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

// Matches KasPay's own theme (manifest.json: theme_color/background_color) so the
// two sibling Kaspa apps look related.
const TEAL = '#00D4AA';
const DARK = '#0B1A2A';
const GRAY = '#5B6B7A';

const STRINGS = {
  de: {
    subtitle: 'Proof of Existence — Zeitstempel-Zertifikat',
    testnetBanner: 'TESTNET — kein produktiver Zeitstempel, nur zu Testzwecken',
    fieldHash: 'SHA-256 Hash des Dokuments',
    fieldFilename: 'Dateiname (optional, kosmetisch)',
    fieldTxid: 'Kaspa Transaktions-ID',
    fieldNetwork: 'Netzwerk',
    fieldStatus: 'Status',
    fieldAnchoredAt: 'Verankert am',
    fieldConfirmedAt: 'Bestätigt am',
    qrCaption: 'Scannen zum unabhängigen Verifizieren',
    legalTitle: 'RECHTLICHER HINWEIS',
    disclaimer:
      '„StampDAG“ ersetzt keinen amtlich bestellten Notar und keine notarielle Beurkundung im Sinne des deutschen ' +
      'Beurkundungsgesetzes. Das System erbringt einen technischen Existenz- und Zeitstempel-Nachweis (Proof of ' +
      'Existence), vergleichbar mit einem digitalen Poststempel. Für rechtsverbindliche Beglaubigungen, öffentliche ' +
      'Urkunden oder Willenserklärungen mit Formzwang (z. B. Grundstücksverträge, Eheverträge) bleibt ein realer ' +
      'Notar erforderlich.',
    footer: (date) => `Erstellt am ${date} · stampdag`,
    status: { pending: 'Ausstehend', confirmed: 'Bestätigt', failed: 'Fehlgeschlagen' },
    locale: 'de-DE',
  },
  en: {
    subtitle: 'Proof of Existence — Timestamp Certificate',
    testnetBanner: 'TESTNET — not a production timestamp, for testing only',
    fieldHash: 'SHA-256 hash of the document',
    fieldFilename: 'Filename (optional, cosmetic)',
    fieldTxid: 'Kaspa transaction ID',
    fieldNetwork: 'Network',
    fieldStatus: 'Status',
    fieldAnchoredAt: 'Anchored on',
    fieldConfirmedAt: 'Confirmed on',
    qrCaption: 'Scan to verify independently',
    legalTitle: 'LEGAL NOTICE',
    disclaimer:
      '"StampDAG" does not replace a licensed notary or notarization under German notarization law ' +
      '(Beurkundungsgesetz). The system provides a technical proof of existence and timestamp, comparable to a ' +
      'digital postmark. A real notary remains required for legally binding certifications, public deeds, or ' +
      'declarations subject to formal requirements (e.g. real estate contracts, marriage contracts). This English ' +
      'text is a plain translation for convenience — the German original is the authoritative legal wording.',
    footer: (date) => `Generated on ${date} · stampdag`,
    status: { pending: 'Pending', confirmed: 'Confirmed', failed: 'Failed' },
    locale: 'en-US',
  },
};

function stringsFor(lang) {
  return STRINGS[lang] || STRINGS.de;
}

function formatDate(iso, S) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(S.locale, { dateStyle: 'medium', timeStyle: 'medium' });
}

async function buildCertificatePdf({ sha256Hash, txid, network, status, anchoredAt, confirmedAt, filenameLabel, verifyUrl, explorerUrl, lang }) {
  const S = stringsFor(lang);
  const qrPng = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 300, margin: 1, color: { dark: DARK, light: '#FFFFFF' } });

  const doc = new PDFDocument({ size: 'A4', margin: 56 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.rect(0, 0, doc.page.width, 90).fill(DARK);
  doc.fillColor(TEAL).fontSize(26).font('Helvetica-Bold').text('StampDAG', 56, 28);
  doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica').text(S.subtitle, 56, 60);

  let y = 110;

  if (network === 'testnet-10') {
    doc.rect(56, y, doc.page.width - 112, 26).fill('#7A1F1F');
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text(S.testnetBanner, 56, y + 8, {
      width: doc.page.width - 112,
      align: 'center',
    });
    y += 40;
  }

  function field(label, value, opts = {}) {
    doc.fillColor(GRAY).fontSize(9).font('Helvetica-Bold').text(label.toUpperCase(), 56, y);
    y += 14;
    doc.fillColor(DARK).fontSize(opts.mono ? 11 : 12).font(opts.mono ? 'Courier' : 'Helvetica');
    if (opts.link) {
      doc.fillColor('#1155CC').text(value, 56, y, { link: opts.link, underline: true, width: doc.page.width - 112 });
    } else {
      doc.text(value, 56, y, { width: doc.page.width - 112 });
    }
    y = doc.y + 14;
  }

  field(S.fieldHash, sha256Hash, { mono: true });
  if (filenameLabel) field(S.fieldFilename, filenameLabel);
  field(S.fieldTxid, txid, { mono: true, link: explorerUrl });
  field(S.fieldNetwork, network);
  field(S.fieldStatus, S.status[status] || status);
  field(S.fieldAnchoredAt, formatDate(anchoredAt, S));
  if (confirmedAt) field(S.fieldConfirmedAt, formatDate(confirmedAt, S));

  const qrY = y + 10;
  doc.image(qrPng, 56, qrY, { width: 130 });
  doc.fillColor(GRAY).fontSize(9).font('Helvetica').text(S.qrCaption, 56, qrY + 136, { width: 130, align: 'center' });

  y = qrY + 160;

  doc.moveTo(56, y).lineTo(doc.page.width - 56, y).strokeColor('#DDDDDD').stroke();
  y += 16;

  doc.fillColor(GRAY).fontSize(9).font('Helvetica-Bold').text(S.legalTitle, 56, y);
  y += 14;
  doc.fillColor(DARK).fontSize(9.5).font('Helvetica').text(S.disclaimer, 56, y, { width: doc.page.width - 112, align: 'justify' });

  // Flows naturally after the disclaimer rather than pinning to an absolute
  // page.height offset -- a fixed offset near the bottom margin can end up below the
  // area PDFKit treats as printable, which silently forces a spurious second page.
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(S.footer(formatDate(new Date().toISOString(), S)), 56, doc.y + 20, {
    width: doc.page.width - 112,
    align: 'center',
  });

  doc.end();
  return done;
}

module.exports = { buildCertificatePdf };
