// TimeWren-farverne kommer fra webbrandets brandkit (public/brand/timewren/README.md i
// mahope/timetrack, commit 6927f7b33c). Cloud-hostname skal stadig bekræftes før udgivelse.
export const timewren = {
  name: 'TimeWren',
  applicationId: 'com.timewren.app',
  scheme: 'timewren',
  cloudUrl: 'https://app.timewren.com',
  // Links i appen (Om, vilkår, abonnement). Alle tre svarede 200 den 21/11-26.
  websiteUrl: 'https://timewren.com',
  privacyUrl: 'https://timewren.com/privacy',
  termsUrl: 'https://timewren.com/terms',
  // App Store-id til "Opdatér appen"; Google Play bruger applicationId.
  appStoreId: '6832757501',
  // Wren: fjerbrun, mærkets hovedfarve. Bruges til notifikationsfarven.
  primaryColor: '#8A5A2B',
  // Lichen: lys flade bag mærket (splash og adaptivt ikon).
  backgroundColor: '#E8EDE3',
  // Thicket: dyb grøn, flade i mørk tilstand.
  darkColor: '#3F5A3A',
};

/** TimeTracks værdier for de brandfelter, appen viser og linker til. */
export const timetrack = {
  name: 'TimeTrack',
  // Production-bundlen; development og preview har egne id'er i env.ts.
  applicationId: 'dk.timetrack.app',
  cloudUrl: 'https://app.timetrack.dk',
  websiteUrl: 'https://timetrack.dk',
  privacyUrl: 'https://timetrack.dk/privacy',
  termsUrl: 'https://timetrack.dk/terms',
  // eas.json: submit.production.ios.ascAppId.
  appStoreId: '6812371822',
};

/** Det fælles udsnit, appen bruger til navn, links og butikssider. */
export type Brand = typeof timetrack;
