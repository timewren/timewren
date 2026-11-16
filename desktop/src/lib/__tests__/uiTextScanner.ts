import ts from "typescript";

/**
 * Finder dansk (eller al anden hardkodet) UI-tekst i `.tsx`-kilder.
 *
 * K20 fjeg 85 danske inline-fallbacks fra `t()`-kald, og `i18n.test.ts` vogter
 * at nøglerne findes i alle 5 locales. Men den port læser kun strenge, der står
 * som *nøgleformer* — altså med et punktum i sig. Brugertekst der står som rå
 * JSX (`Gemt`), i en attribut (`aria-label="Luk dialog"`) eller i et toast-kald
 * (`toast.error("Kunne ikke …")`) er ikke nøgler, så den port har aldrig set
 * den. Det er præcis den klasse fundet i reviewen 30/9 handlede om: en dansk
 * sætning i koden, ingen sætning i json, ingen port der siger det.
 *
 * Kilden læses med TypeScript's egen parser, ikke med regex. Regex kan ikke
 * skelne `brug >C<` i JSX fra `useState<string[]>([])`, og en port der
 * producerer 390 fund hvor de 380 er typekode bliver slettet som støj. AST'en
 * ved hvad der er markup.
 *
 * Scanneren dømmer to slags steder:
 *   1. `JsxText` — tekst mellem tags, som et menneske læser på skærmen.
 *   2. Strenge i *UI-stillinger* — attributter en skærmlæser læser højt,
 *      properties der bliver en synlig etiket, og argumenter til `toast.*`
 *      eller en `set*`-sætter. `className` er ikke en UI-stilling; det er CSS.
 *
 * Punkt 2 dømmer strengen *hvor den end står i argumentet*: `toast.error(
 * typeof err === "string" ? err : "Kunne ikke …")` og `setSaveStatus(
 * fejl ? "Fejl ved gemning" : "Gemt")` er lige så brugerrettede som den rå
 * form, så begge grene af en terning eller et logisk udtryk dømmes med. Det var
 * præcis den blinde plet, fundet fra 30/9 viste: `setSaveStatus("Fejl ved
 * gemning")` stod i to filer, og porten så ingen af strengene.
 *
 * Det er ikke alle strenge i koden: en id, en CSS-klasse, en SQL-kolonne og en
 * fejl fra Rust hører ikke til. Det er den tekst en bruger kan læse.
 */

/** Attributter hvis værdi læses højt af en skærmlæser eller lander i værktøjstip. */
const UI_ATTRIBUTTER = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "placeholder",
  "title",
  "alt",
  "label",
]);

/** Properties der typisk bliver en synlig etiket, et tooltip eller en ledetekst. */
const UI_PROPERTIES = new Set([
  "label",
  "title",
  "description",
  "placeholder",
  "emptyText",
  "helperText",
  "confirmLabel",
  "cancelLabel",
  "ariaLabel",
]);

/** Kalde, hvis første streng-argument er en besked til brugeren. */
const TOAST_KALD = new Set([
  "toast.success",
  "toast.error",
  "toast.info",
  "toast.warning",
]);

/**
 * En `set*`-sætter skriver sin værdi ind i en state, og den state renderes.
 * Derfor er dens første streng-argument lige så meget UI-tekst som et toast.
 * Mønstret kræver et stort bogstav efter `set`, så `settings.save()` og
 * `gettext()` ikke kommer med.
 */
const SAETTER = /^set[A-Z]\w*$/;

/** Operatorer der *vælger* mellem to strenge, så begge grene er synlige. */
const LOGISK = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/** Ét tilstandstoken: ét ord der ligner en variabel (`success`, `upToDate`). */
const TILSTAND = /^[a-z][A-Za-z0-9_]*$/;

/** En oversættelsesnøgle: `timeline.bulkDelete`. Punkter kraviterer samme som i K27. */
const NOEGLEFORM = /^[a-z][A-Za-z0-9]*(\.[a-zA-Z][A-Za-z0-9]*)+$/;

/**
 * Kan strengen være noget en bruger læser?
 *
 * Sætter kaldes med to slags strenge. Det ene er en *tilstand* — `setStatus
 * ("success")`, `setLicenseState("valid")` — som aldrig males, kun sammenlignes.
 * Det andet er en *besked* — `setSyncMessage("Indtast en iCal-URL først")` —
 * som renderes. De er ikke til at skelne på kaldet, kun på formen: en besked er
 * en sætning med mellemrum eller et ord med stort begyndelsesbogstav, en
 * tilstand er ét lille ord.
 *
 * En nøgleform er heller ikke en besked, uanset at den har et punktum og derfor
 * ikke ligner en tilstand. `i18n.test.ts` dømmer nøgler i hele appen, så dem
 * skal denne port ikke tage.
 *
 * Uden skelnen blev reglen 28 fund hvor de 25 var tilstande, og det er præcis
 * den port, der bliver slettet som støj. Målt 30/9 på hele `src/`.
 */
function erBeskyldt(tekst: string): boolean {
  if (NOEGLEFORM.test(tekst)) return false;
  return /\s/.test(tekst) || !TILSTAND.test(tekst);
}

/** Hvidrum kollapseres, så fund kan slås op på den samme tekst hver gang. */
function norm(tekst: string): string {
  return tekst.replace(/\s+/g, " ").trim();
}

/** Ét fund — nok til at slås op i undtagelseslisten og til at finde igen. */
export interface Fund {
  file: string;
  linje: number;
  tekst: string;
  regel: "jsx" | "jsx-udtryk" | "attribut" | "property" | "toast" | "sætter";
}

function erTekst(tekst: string): boolean {
  return /[A-Za-zÆØÅæøåÄÖÜäöüß]/.test(tekst);
}

/** Kaldes navnet på den måde, kilden skriver det: `toast.success`. */
function kaldenavn(node: ts.Node): string {
  if (ts.isPropertyAccessExpression(node)) {
    return `${node.expression.getText()}.${node.name.text}`;
  }
  return node.getText();
}

/** Navnet på en property-nøgle, hvad enten den er skrevet som identifikator eller streng. */
function propertynavn(node: ts.PropertyName): string {
  return ts.isIdentifier(node) || ts.isStringLiteral(node)
    ? node.text
    : node.getText();
}

/**
 * Klatrer fra en streng op til hele det udtryk den er en del af.
 *
 * `setX(fejl ? "Fejl" : "Gemt")` gør `"Fejl"` til en *gren* af et argument, så
 * dens umiddelbare forælder ikke er kaldet. Uden denne klatring er præcis den
 * form usynlig, og den er fundet to gange i samme review. En parentes er det
 * samme problem med en anden tudse: den skjuler strengen uden at ændre den.
 */
function heleArgument(node: ts.Node): ts.Node {
  let udtryk = node;
  for (let forælder = udtryk.parent; ; forælder = udtryk.parent) {
    if (
      ts.isConditionalExpression(forælder) ||
      ts.isParenthesizedExpression(forælder) ||
      (ts.isBinaryExpression(forælder) &&
        LOGISK.has(forælder.operatorToken.kind))
    ) {
      udtryk = forælder;
    } else {
      return udtryk;
    }
  }
}

/**
 * The text of a template literal, with each `${…}` replaced by a
 * representative number.
 *
 * `${newCount} nye begivenheder importeret` must be judged as the message it is,
 * not as `nye begivenheder importeret` — and it has to be matchable in the
 * exception list, so the number has to be part of it. Hence `4`, which also
 * lets the gate tell a template apart from a bare key shape.
 *
 * `0 0 ${SIZE} ${SIZE}` becomes `0 0 4 4`, which `erTekst` rejects because it
 * holds only digits — exactly the svg that is not text.
 *
 * The spans are read off the AST, not with a regex over the source: an
 * interpolated value can itself contain an object literal with braces
 * (`` `${t("pomodoro.dayCount", { count: n })}` ``), and `${[^}]*}` stops at
 * the first `}` and leaves the rest as text. That produced a finding reading
 * `4 : 4 ) : t("pomodoro.dayNone") }` — the gate judging its own bug.
 */
function templateText(node: ts.TemplateExpression): string {
  let out = node.head.text;
  for (const span of node.templateSpans) {
    out += " 4 ";
    out += span.literal.text;
  }
  return out;
}

/**
 * Fund i én kildefil. `source` skal være kommentarfrit (se `stripComments` i
 * `i18n.test.ts`), ellers ville et eksempel i en kommentar dømmes — kommentarer
 * er ikke AST-noder, så det er ikke gratis.
 */
export function scanFil(file: string, source: string): Fund[] {
  const fund: Fund[] = [];
  const kilde = ts.createSourceFile(
    `${file}.tsx`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const tilføj = (regel: Fund["regel"], node: ts.Node, rå: string): void => {
    const tekst = norm(rå);
    if (!erTekst(tekst)) return;
    const { line } = kilde.getLineAndCharacterOfPosition(node.getStart());
    fund.push({ file, linje: line + 1, tekst, regel });
  };

  const besøg = (node: ts.Node): void => {
    // 1. Rå tekst mellem tags.
    if (ts.isJsxText(node)) {
      tilføj("jsx", node, node.text);
    }

    // 2. Strenge i UI-stillinger. `StringLiteral` dækker både `"…"` og
    //    attribut-værdier; template literals med ${} er ikke gyldige JSX-børn
    //    alligevel, så de dømmes ikke her.
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const rå =
        node.kind === ts.SyntaxKind.TemplateExpression
          ? templateText(node as ts.TemplateExpression)
          : node.text;
      const forælder = node.parent;
      if (ts.isJsxAttribute(forælder)) {
        if (
          ts.isIdentifier(forælder.name) &&
          UI_ATTRIBUTTER.has(forælder.name.text)
        ) {
          tilføj("attribut", node, rå);
        }
      } else if (ts.isPropertyAssignment(forælder)) {
        if (UI_PROPERTIES.has(propertynavn(forælder.name))) {
          tilføj("property", node, rå);
        }
      } else {
        // 3. Første streng-argument til et toast-kald eller en sætter — også
        //    når strengen sidder i en gren af en terning eller et logisk
        //    udtryk. `regel` skelner, så et fund i en toast ikke ligner et
        //    fund i en sætter, når det skal slås op i listen.
        const hel = heleArgument(node);
        const kald = hel.parent;
        if (ts.isCallExpression(kald) && kald.arguments[0] === hel) {
          const navn = kaldenavn(kald.expression);
          if (TOAST_KALD.has(navn)) tilføj("toast", node, rå);
          else if (SAETTER.test(navn)) {
            if (erBeskyldt(norm(rå))) tilføj("sætter", node, rå);
          }
        } else if (
          // 4. Strenge i en JSX-`-container`. `{a ?? "Ingen projekt"}` er
          //    markup, så den er lige så synlig som `JsxText` — men den er
          //    ikke et `JsxText`-node, fordi der står kode omkring den. Uden
          //    denne regel så `CalendarEntry` ingen af dem, selv om nøglen
          //    `calendar.noProject` lå i alle fem sprog.
          ts.isJsxExpression(hel.parent) &&
          ts.isJsxElement(hel.parent.parent)
        ) {
          // Samme skeln som i sætterreglen, og af samme grund: `{"success"}`
          // og `{"ab"}` er nøgler og id'er, ikke tekst, og en regel der dømmer
          // dem giver fund, der skal slettes som støj — hvorefter ingen holder
          // porten i live. Målt 1/10: uden skeln dømte reglen begge.
          if (erBeskyldt(norm(rå))) tilføj("jsx-udtryk", node, rå);
        }
      }
    }

    ts.forEachChild(node, besøg);
  };

  ts.forEachChild(kilde, besøg);
  return fund.sort((a, b) => a.linje - b.linje);
}
